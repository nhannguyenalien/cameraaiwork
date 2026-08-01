const axios = require("axios");

const API_KEY = process.env.RUNPOD_API_KEY || "";
const ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "";

// Fire-and-forget style: submit a heavy job, get back a job id to poll later.
// Never await this inline in a request handler that needs to respond fast —
// GPU jobs can take seconds to minutes.
async function submitJob(task, input = {}) {
  if (!API_KEY || !ENDPOINT_ID) {
    throw new Error("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured");
  }

  const res = await axios.post(
    `https://api.runpod.ai/v2/${ENDPOINT_ID}/run`,
    { input: { task, ...input } },
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  );
  return res.data.id;
}

async function getJobStatus(jobId) {
  const res = await axios.get(`https://api.runpod.ai/v2/${ENDPOINT_ID}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return res.data;
}

module.exports = { submitJob, getJobStatus };
