/**
 * Zero-dependency static dev server for the ant evolution simulation.
 * Runs with `npm run dev`.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const START_PORT = parseInt(process.env.PORT, 10) || 8765;
const MAX_PORT = START_PORT + 20;
const ROOT = path.resolve(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function requestHandler(req, res) {
  let filePath = path.join(ROOT, req.url === "/" ? "index.html" : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server error");
      }
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function tryListen(port) {
  const server = http.createServer(requestHandler);

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && port < MAX_PORT) {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      server.close();
      tryListen(port + 1);
    } else {
      console.error("Server error:", err.message);
      process.exit(1);
    }
  });

  server.once("listening", () => {
    console.log(`Ant evolution sim running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop");
  });

  server.listen(port);
}

tryListen(START_PORT);
