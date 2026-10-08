import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY automatically.
// WHEN_REQUIRED stops newer SDK versions from adding checksum parameters to
// presigned URLs, which would break browser uploads.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

const BUCKET = process.env.S3_BUCKET;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TTL_MS = 24 * 60 * 60 * 1000; // links valid for 24 hours
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ATTEMPTS = 5; // wrong codes before the link is locked

// id -> { key, filename, size, salt, codeHash, expiresAt, failedAttempts }
// In-memory on purpose (simple). See Exercise 1 for a durable version.
const shares = new Map();

// ---------- helpers ----------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

function generateCode(length = 8) {
  return Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}

function hashCode(code, salt) {
  return crypto.scryptSync(code, salt, 32);
}

function codeMatches(code, record) {
  const candidate = hashCode(code, record.salt);
  return crypto.timingSafeEqual(candidate, record.codeHash); // constant-time compare
}

// Remove expired records every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of shares) if (now > r.expiresAt) shares.delete(id);
}, 10 * 60 * 1000);

// ---------- 1. create upload ----------
app.post('/api/uploads', async (req, res) => {
  try {
    const { filename, contentType, size } = req.body;

    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'filename is required' });
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) {
      return res.status(400).json({ error: 'size must be between 1 byte and 10 MB' });
    }

    const type = contentType || 'application/octet-stream';
    const id = crypto.randomBytes(9).toString('base64url'); // unguessable share ID
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${id}/${safeName}`; // must stay under the lifecycle prefix

    const code = generateCode();
    const salt = crypto.randomBytes(16);
    const expiresAt = Date.now() + TTL_MS;

    // ContentType and ContentLength are signed: S3 rejects an upload that differs.
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: type,
        ContentLength: size,
      }),
      { expiresIn: 300 },
    );

    shares.set(id, {
      key,
      filename: safeName,
      size,
      salt,
      codeHash: hashCode(code, salt), // the plain code is never stored
      expiresAt,
      failedAttempts: 0,
    });

    res.json({
      id,
      code, // shown to the uploader exactly once
      shareUrl: `${BASE_URL}/s/${id}`,
      uploadUrl,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create upload' });
  }
});

// ---------- 2. share page ----------
app.get('/s/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// ---------- 3. verify code and issue download URL ----------
app.post('/api/shares/:id/access', async (req, res) => {
  try {
    const record = shares.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Link not found' });

    if (Date.now() > record.expiresAt) {
      shares.delete(req.params.id);
      return res.status(410).json({ error: 'This link has expired' });
    }
    if (record.failedAttempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many wrong codes. Link is locked.' });
    }

    const code = String(req.body.code || '').trim().toUpperCase();
    if (!codeMatches(code, record)) {
      record.failedAttempts += 1;
      return res.status(403).json({ error: 'Wrong secret code' });
    }

    // Make sure the browser really finished the upload
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: record.key }));
    } catch {
      return res.status(404).json({ error: 'File is not available' });
    }

    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: record.key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
      }),
      { expiresIn: 60 },
    );

    res.json({ downloadUrl, filename: record.filename, size: record.size });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create download URL' });
  }
});

app.listen(PORT, () => console.log(`TempShare running at ${BASE_URL}`));
