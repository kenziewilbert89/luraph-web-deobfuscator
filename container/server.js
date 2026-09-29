const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = 8080;
const ENGINE_DIR = "/app/engine";
const JOB_ROOT = "/tmp/luraph-jobs";

fs.mkdirSync(JOB_ROOT, { recursive: true });

const jobs = new Map();

const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: 20 * 1024 * 1024 }
});

function json(res, status, body) {
  res.status(status).json(body);
}

function setStage(job, progress, stage, detail) {
  job.progress = progress;
  job.stage = stage;
  job.detail = detail;
  job.updatedAt = Date.now();
}

function runDeobfuscator(job) {
  const inputPath = job.inputPath;
  const jobDir = job.jobDir;
  const outputDir = path.join(jobDir, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  setStage(job, 15, "Detecting Luraph V15", "Scanning source and identifying the obfuscation layer...");

  const child = spawn("node", ["deob.js", inputPath], {
    cwd: ENGINE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  job.child = child;

  let stdout = "";
  let stderr = "";

  const updateFromLog = (line) => {
    const s = line.toLowerCase();

    if (s.includes("luraph") || s.includes("detected")) {
      setStage(job, 20, "Detecting Luraph V15", "Luraph V15 signature detected.");
    } else if (s.includes("trace") || s.includes("tracing")) {
      setStage(job, 48, "Tracing execution", "Tracing virtualized execution flow...");
    } else if (s.includes("devirt") || s.includes("devirtual")) {
      setStage(job, 68, "Devirtualizing code", "Reconstructing instructions from the VM...");
    } else if (s.includes("reconstruct") || s.includes("output")) {
      setStage(job, 86, "Reconstructing Lua", "Building the readable Lua source...");
    }
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    for (const line of text.split(/\r?\n/)) updateFromLog(line);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    for (const line of text.split(/\r?\n/)) updateFromLog(line);
  });

  const progressTimer = setInterval(() => {
    if (!jobs.has(job.id) || job.status !== "processing") {
      clearInterval(progressTimer);
      return;
    }

    // Smooth visual progress while the actual engine is running.
    // It never reaches 100% until the subprocess really completes.
    if (job.progress < 92) {
      job.progress += 1;
      job.updatedAt = Date.now();
    }
  }, 900);

  child.on("error", (error) => {
    clearInterval(progressTimer);
    job.status = "failed";
    job.progress = 100;
    job.stage = "Failed";
    job.detail = error.message;
    job.error = error.message;
    job.updatedAt = Date.now();
  });

  child.on("close", (code) => {
    clearInterval(progressTimer);

    const expectedOutput = path.join(
      ENGINE_DIR,
      "output",
      path.basename(inputPath)
    );

    if (code !== 0) {
      job.status = "failed";
      job.progress = 100;
      job.stage = "Failed";
      job.detail = "The deobfuscator process exited with an error.";
      job.error = (stderr || stdout || `Process exited with code ${code}`).slice(-12000);
      job.updatedAt = Date.now();
      return;
    }

    if (!fs.existsSync(expectedOutput)) {
      job.status = "failed";
      job.progress = 100;
      job.stage = "Failed";
      job.detail = "The deobfuscator finished, but no output file was produced.";
      job.error = (stderr || stdout || "Output file not found.").slice(-12000);
      job.updatedAt = Date.now();
      return;
    }

    const finalName = path.basename(job.originalName);
    const finalPath = path.join(outputDir, finalName);
    fs.copyFileSync(expectedOutput, finalPath);

    job.outputPath = finalPath;
    job.status = "completed";
    job.progress = 100;
    job.stage = "Complete";
    job.detail = "Deobfuscation completed successfully.";
    job.download = `/api/download/${job.id}`;
    job.updatedAt = Date.now();

    // Keep the latest result available for a reasonable period.
    setTimeout(() => {
      const current = jobs.get(job.id);
      if (!current || current.status === "processing") return;
      try {
        fs.rmSync(job.jobDir, { recursive: true, force: true });
      } catch {}
      jobs.delete(job.id);
    }, 30 * 60 * 1000);
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    service: "luraph-container",
    engine: "Deobfuscator-Luraph-V15"
  });
});

app.post("/api/deobfuscate", upload.single("file"), (req, res) => {
  if (!req.file) {
    return json(res, 400, {
      success: false,
      error: "File .lua tidak ditemukan."
    });
  }

  const originalName = req.file.originalname || "input.lua";

  if (!originalName.toLowerCase().endsWith(".lua")) {
    fs.rmSync(req.file.path, { force: true });
    return json(res, 400, {
      success: false,
      error: "Hanya file .lua yang diperbolehkan."
    });
  }

  const id = crypto.randomUUID();
  const jobDir = path.join(JOB_ROOT, id);
  const inputPath = path.join(jobDir, "input.lua");

  fs.mkdirSync(jobDir, { recursive: true });
  fs.renameSync(req.file.path, inputPath);

  const job = {
    id,
    originalName,
    inputPath,
    jobDir,
    status: "processing",
    progress: 5,
    stage: "Uploading source",
    detail: "Source file received. Preparing the deobfuscation engine.",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  jobs.set(id, job);
  runDeobfuscator(job);

  return json(res, 202, {
    success: true,
    jobId: id,
    status: "processing",
    progress: job.progress
  });
});

app.get("/api/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return json(res, 404, {
      success: false,
      error: "Job tidak ditemukan atau sudah kedaluwarsa."
    });
  }

  return json(res, 200, {
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    detail: job.detail,
    download: job.download || null,
    filename: job.status === "completed"
      ? `deobfuscated_${job.originalName}`
      : null,
    error: job.error || null
  });
});

app.get("/api/download/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job || job.status !== "completed" || !job.outputPath) {
    return res.status(404).send("Result not found.");
  }

  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).send("Result file not found.");
  }

  res.download(
    job.outputPath,
    `deobfuscated_${job.originalName}`
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Luraph container listening on ${PORT}`);
});
