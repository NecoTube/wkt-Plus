const axios = require('axios');

let apis = null;
let xeroxApis = null;
let minTubeApis = null;
const MAX_API_WAIT_TIME = 5000; 
const MAX_TIME = 10000;       // 高速サーバー用 (10秒)
const MAX_TIME_SLOW = 20000;  // 低速サーバー用 (20秒)

// 配列をランダムにシャッフルする関数
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// =========================================
// ① Invidious API からの取得
// =========================================
async function getapis() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/apis/Invidious/yes.json');
        apis = await response.data;
    } catch (error) {
        console.error('Invidiousサーバーリストの取得に失敗:', error);
    }
}

async function ggvideo(videoId) {
    const startTime = Date.now();
    if (!apis) await getapis();
    if (!apis) throw new Error("InvidiousのAPIリストがありません");

    for (const instance of apis) {
        try {
            const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, { timeout: MAX_API_WAIT_TIME });
            if (response.data && response.data.formatStreams) return response.data;
        } catch (error) {
            console.error(`エラー: ${instance} - ${error.message}`);
        }
        if (Date.now() - startTime >= MAX_TIME) throw new Error("接続がタイムアウトしました");
    }
    throw new Error("Invidiousで動画を取得できませんでした");
}

async function getInvidious(videoId) {
    const videoInfo = await ggvideo(videoId);
    
    const formatStreams = videoInfo.formatStreams || [];
    let streamUrl = formatStreams.find(s => String(s.itag) === '18')?.url || formatStreams.reverse()[0]?.url || '';
    
    const audioStreams = videoInfo.adaptiveFormats || [];
    const audioUrl = audioStreams.find(s => String(s.itag) === '251')?.url || 
                     audioStreams.find(s => s.container === 'm4a')?.url || '';

    const audioUrls = audioStreams
        .filter(stream => !stream.resolution && (stream.container === 'webm' || stream.container === 'm4a'))
        .map(stream => ({
            url: stream.url,
            name: `${stream.container} (${stream.audioBitrate || 'auto'}kbps)`,
            container: stream.container
        }));

    let highstreamUrl = audioStreams
        .filter(stream => (stream.container === 'webm' || stream.container === 'mp4') && stream.resolution === '1080p')
        .map(stream => stream.url)[0];
        
    const streamUrls = audioStreams
        .filter(stream => (stream.container === 'webm' || stream.container === 'mp4') && stream.resolution)
        .map(stream => ({
            url: stream.url,
            resolution: stream.resolution,
            container: stream.container,
            fps: stream.fps || null
        }));
        
    if (videoInfo.hlsUrl) streamUrl = videoInfo.hlsUrl; 
    
    return { stream_url: streamUrl, highstreamUrl, audioUrl, audioUrls, streamUrls };
}

// =========================================
// ② SiaTube API からの取得
// =========================================
async function getSiaTube(videoId) {
    try {
        const response = await axios.get(`https://siawaseok.f5.si/api/streams/${videoId}`, { timeout: MAX_TIME });
        const streams = Array.isArray(response.data) ? response.data : (response.data.formats || []);
        
        const audioStream = streams.find(s => String(s.format_id) === '251' || String(s.itag) === '251') || 
                            streams.find(s => s.vcodec === 'none' && s.acodec === 'opus') || 
                            streams.find(s => s.vcodec === 'none');
        const audioUrl = audioStream?.url || '';

        const audioUrls = streams
            .filter(s => s.vcodec === 'none' && (s.ext === 'webm' || s.ext === 'm4a'))
            .map(s => ({
                url: s.url,
                name: `${s.ext} (${s.abr || 'auto'}kbps)`,
                container: s.ext
            }));

        const combinedStream = streams.find(s => String(s.format_id) === '18' || String(s.itag) === '18') || 
                               streams.find(s => s.vcodec !== 'none' && s.acodec !== 'none');
        const streamUrl = combinedStream?.url || '';

        const isLive = streams.some(s => s.url && (s.url.includes('manifest') || s.url.includes('.m3u8')));
        const videoStreams = streams.filter(s => {
            if (!s.url || s.vcodec === 'none') return false;
            if (isLive) return true;
            return s.acodec === 'none';
        });

        const streamUrls = videoStreams.map(s => {
            let res = s.resolution || '';
            if (res.includes('x')) res = res.split('x')[1] + 'p';
            return {
                url: s.url,
                resolution: res,
                container: s.ext || 'mp4',
                fps: s.fps || null
            };
        });

        return {
            stream_url: streamUrl || streamUrls[0]?.url || '',
            highstreamUrl: streamUrls.find(s => s.resolution === '1080p')?.url || streamUrls[0]?.url || '',
            audioUrl: audioUrl,
            audioUrls: audioUrls,
            streamUrls: streamUrls
        };
    } catch (error) {
        throw new Error("SiaTubeからの取得に失敗: " + error.message);
    }
}

// =========================================
// ③ YuZuTube API からの取得
// =========================================
async function getYuZuTube(videoId) {
    try {
        const response = await axios.get(`https://yudlp.vercel.app/stream/${videoId}`, { timeout: MAX_TIME });
        const streams = Array.isArray(response.data) ? response.data : (response.data.formats || []);
        
        const audioStream = streams.find(s => String(s.format_id) === '251' || String(s.itag) === '251') || 
                            streams.find(s => s.resolution === 'audio only');
        const audioUrl = audioStream?.url || '';

        const audioUrls = streams
            .filter(s => s.resolution === 'audio only' && (s.ext === 'webm' || s.ext === 'm4a'))
            .map(s => ({
                url: s.url,
                name: `${s.ext} (${s.abr || 'auto'}kbps)`,
                container: s.ext
            }));

        const combinedStream = streams.find(s => String(s.format_id) === '18' || String(s.itag) === '18');
        const streamUrl = combinedStream?.url || '';

        const isLive = streams.some(s => s.url && (s.url.includes('manifest') || s.url.includes('.m3u8')));
        const videoStreams = streams.filter(s => {
            if (!s.url || s.resolution === 'audio only') return false;
            if (isLive) return true;
            return !['18', '22'].includes(String(s.format_id || s.itag));
        });
        
        const streamUrls = videoStreams.map(s => {
            let res = s.resolution || '';
            if (res.includes('x')) res = res.split('x')[1] + 'p';
            return {
                url: s.url,
                resolution: res,
                container: s.ext || 'mp4',
                fps: s.fps || null
            };
        });

        return {
            stream_url: streamUrl || streamUrls[0]?.url || '',
            highstreamUrl: streamUrls.find(s => s.resolution === '1080p')?.url || streamUrls[0]?.url || '',
            audioUrl: audioUrl,
            audioUrls: audioUrls,
            streamUrls: streamUrls
        };
    } catch (error) {
        throw new Error("YuZuTubeからの取得に失敗: " + error.message);
    }
}

// =========================================
// ★ 新規追加: KatuoTube API からの取得
// =========================================
async function getKatuoTube(videoId) {
    try {
        const response = await axios.get(`https://ytdlpinstance-vercel.vercel.app/stream/${videoId}`, { timeout: MAX_TIME });
        const streams = Array.isArray(response.data) ? response.data : (response.data.formats || []);
        
        const audioStream = streams.find(s => String(s.format_id) === '251' || String(s.itag) === '251') || 
                            streams.find(s => s.resolution === 'audio only' || s.vcodec === 'none');
        const audioUrl = audioStream?.url || '';

        const audioUrls = streams
            .filter(s => (s.resolution === 'audio only' || s.vcodec === 'none') && (s.ext === 'webm' || s.ext === 'm4a'))
            .map(s => ({
                url: s.url,
                name: `${s.ext} (${s.abr || 'auto'}kbps)`,
                container: s.ext
            }));

        const combinedStream = streams.find(s => String(s.format_id) === '18' || String(s.itag) === '18');
        const streamUrl = combinedStream?.url || '';

        const isLive = streams.some(s => s.url && (s.url.includes('manifest') || s.url.includes('.m3u8')));
        const videoStreams = streams.filter(s => {
            if (!s.url || s.resolution === 'audio only' || s.vcodec === 'none') return false;
            if (isLive) return true;
            return !['18', '22'].includes(String(s.format_id || s.itag));
        });
        
        const streamUrls = videoStreams.map(s => {
            let res = s.resolution || '';
            if (res.includes('x')) res = res.split('x')[1] + 'p';
            return {
                url: s.url,
                resolution: res,
                container: s.ext || 'mp4',
                fps: s.fps || null
            };
        });

        return {
            stream_url: streamUrl || streamUrls[0]?.url || '',
            highstreamUrl: streamUrls.find(s => s.resolution === '1080p')?.url || streamUrls[0]?.url || '',
            audioUrl: audioUrl,
            audioUrls: audioUrls,
            streamUrls: streamUrls
        };
    } catch (error) {
        throw new Error("KatuoTubeからの取得に失敗: " + error.message);
    }
}

// =========================================
// ④ XeroxYT-NT API からの取得 (低速・ランダム)
// =========================================
async function getXeroxApis() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/toka-kun/Education/refs/heads/main/apis/XeroxYT-NT/yes.json');
        xeroxApis = await response.data;
    } catch (error) {
        console.error('Xerox-NTサーバーリストの取得に失敗:', error);
    }
}

async function getXeroxNT(videoId) {
    const startTime = Date.now();
    if (!xeroxApis) await getXeroxApis();
    if (!xeroxApis || xeroxApis.length === 0) throw new Error("Xerox-NTのAPIリストがありません");

    // リストをシャッフルしてランダムに試す
    const shuffledApis = shuffleArray([...xeroxApis]);

    for (const instance of shuffledApis) {
        try {
            const response = await axios.get(`${instance}/stream?id=${videoId}`, { timeout: MAX_TIME_SLOW }); // 低速なので20秒
            const data = response.data;
            
            if (data && data.streamingUrl) {
                const streamUrls = (data.formats || []).map(f => ({
                    url: f.url,
                    resolution: f.quality || (f.height ? f.height + 'p' : ''),
                    container: f.container || 'mp4',
                    fps: null
                }));

                const audioUrls = data.audioUrl ? [{ url: data.audioUrl, name: 'Default Audio', container: 'm4a' }] : [];

                return {
                    stream_url: data.streamingUrl, 
                    highstreamUrl: streamUrls.find(s => s.resolution === '1080p')?.url || data.streamingUrl,
                    audioUrl: data.audioUrl || '',
                    audioUrls: audioUrls,
                    streamUrls: streamUrls
                };
            }
        } catch (error) {
            console.error(`エラー: ${instance} - ${error.message}`);
        }
        if (Date.now() - startTime >= MAX_TIME_SLOW) throw new Error("接続がタイムアウトしました");
    }
    throw new Error("Xerox-NTで動画を取得できませんでした");
}

// =========================================
// ⑤ MIN-Tube2 API からの取得 (高速・ランダム)
// =========================================
async function getMinTube2Apis() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/Minotaur-ZAOU/test/refs/heads/main/min-tube-api.json');
        minTubeApis = await response.data;
    } catch (error) {
        console.error('MIN-Tube2サーバーリストの取得に失敗:', error);
    }
}

async function getMinTube2(videoId) {
    const startTime = Date.now();
    if (!minTubeApis) await getMinTube2Apis();
    if (!minTubeApis || minTubeApis.length === 0) throw new Error("MIN-Tube2のAPIリストがありません");

    // リストをシャッフルしてランダムに試す
    const shuffledApis = shuffleArray([...minTubeApis]);

    for (const instance of shuffledApis) {
        try {
            const response = await axios.get(`${instance}/api/video/${videoId}`, { timeout: MAX_TIME }); // 高速なので10秒
            const data = response.data;
            
            if (data && data.stream_url) {
                const streamUrls = [];
                if (data.stream_url) streamUrls.push({ url: data.stream_url, resolution: '通常画質', container: 'mp4', fps: null });
                if (data.highstreamUrl) streamUrls.push({ url: data.highstreamUrl, resolution: '高画質', container: 'mp4', fps: null });

                const audioUrls = data.audioUrl ? [{ url: data.audioUrl, name: 'Default Audio', container: 'm4a' }] : [];

                return {
                    stream_url: data.stream_url, 
                    highstreamUrl: data.highstreamUrl || data.stream_url,
                    audioUrl: data.audioUrl || '',
                    audioUrls: audioUrls,
                    streamUrls: streamUrls
                };
            }
        } catch (error) {
            console.error(`エラー: ${instance} - ${error.message}`);
        }
        if (Date.now() - startTime >= MAX_TIME) throw new Error("接続がタイムアウトしました");
    }
    throw new Error("MIN-Tube2で動画を取得できませんでした");
}

// =========================================
// ⑥ Wista Stream API からの取得 (低速)
// =========================================
async function getWistaStream(videoId) {
    try {
        const response = await axios.get(`https://simple-yt-stream.onrender.com/api/video/${videoId}`, { timeout: MAX_TIME_SLOW }); // 低速なので20秒
        const streams = response.data.streams || [];
        
        const audioStream = streams.find(s => String(s.format_id) === '251') || 
                            streams.find(s => String(s.format_id) === '140') ||
                            streams.find(s => s.quality === 'medium' || s.quality === 'low');
        const audioUrl = audioStream?.url || '';

        const audioUrls = streams
            .filter(s => String(s.format_id) === '251' || String(s.format_id) === '140')
            .map(s => ({
                url: s.url,
                name: `${s.ext} (${s.quality})`,
                container: s.ext
            }));

        const combinedStream = streams.find(s => String(s.format_id) === '18');
        const streamUrl = combinedStream?.url || '';

        const isLive = streams.some(s => s.url && (s.url.includes('manifest') || s.url.includes('.m3u8')));
        const videoStreams = streams.filter(s => {
            if (!s.url || !s.quality) return false;
            if (isLive) return true;
            return s.quality.includes('p') && String(s.format_id) !== '18' && String(s.format_id) !== '22';
        });
        
        const streamUrls = videoStreams.map(s => {
            return {
                url: s.url,
                resolution: s.quality,
                container: s.ext || 'mp4',
                fps: s.fps || null
            };
        });

        return {
            stream_url: streamUrl || streamUrls[0]?.url || '',
            highstreamUrl: streamUrls.find(s => s.resolution === '1080p')?.url || streamUrls.find(s => s.resolution === '720p')?.url || streamUrls[0]?.url || '',
            audioUrl: audioUrl,
            audioUrls: audioUrls,
            streamUrls: streamUrls
        };
    } catch (error) {
        throw new Error("Wista Streamからの取得に失敗: " + error.message);
    }
}

// =========================================
// 🌟 最終振り分け処理
// =========================================
async function getYouTube(videoId, apiType = 'invidious') {
    let result;
    if (apiType === 'siawaseok') {
        result = await getSiaTube(videoId);
    } else if (apiType === 'yudlp') {
        result = await getYuZuTube(videoId);
    } else if (apiType === 'ytdlpinstance-vercel') {
        result = await getKatuoTube(videoId);
    } else if (apiType === 'xeroxyt-nt-apiv1') {
        result = await getXeroxNT(videoId);
    } else if (apiType === 'min-tube2-api') {
        result = await getMinTube2(videoId);
    } else if (apiType === 'simple-yt-stream') {
        result = await getWistaStream(videoId);
    } else {
        result = await getInvidious(videoId);
    }

    const isLive = result.stream_url && (result.stream_url.includes('manifest') || result.stream_url.includes('.m3u8'));

    if (isLive) {
        result.audioUrl = null; 
        result.audioUrls = []; 

        if (result.streamUrls && result.streamUrls.length > 0) {
            const newStreamUrls = [];
            const seenResolutions = new Set(); 

            result.streamUrls.forEach(stream => {
                let resName = stream.resolution || 'Auto';
                resName = resName.replace(/ \(.+\)/g, '').trim();

                if (!seenResolutions.has(resName)) {
                    seenResolutions.add(resName);
                    newStreamUrls.push({
                        url: stream.url,
                        resolution: resName, 
                        container: 'm3u8',
                        fps: stream.fps
                    });
                }
            });
            result.streamUrls = newStreamUrls; 
        } else {
            result.streamUrls = [{ url: result.stream_url, resolution: 'Auto', container: 'm3u8', fps: null }];
        }
    } else {
        if (result.audioUrl && (result.audioUrl.includes('manifest') || result.audioUrl.includes('.m3u8'))) {
            result.audioUrl = null;
            result.audioUrls = [];
        }
    }

    return result;
}

module.exports = { ggvideo, getapis, getYouTube };
