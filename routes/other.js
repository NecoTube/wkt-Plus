const express = require("express");
const router = express.Router();
const path = require("path");

router.get("/", (req, res) => {
  res.render("other/home");
});

router.get('/others/:id', async (req, res) => {
  const Id = req.params.id;
  res.render(`other/others/${Id}`);
});

module.exports = router;
