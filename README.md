# TempShare

Runnable files from *Practicum: Temporary File Sharing with Amazon S3 Presigned URLs*.

```
tempshare/
├── .env                  # section 3.3 – dummy values, replace with your own
├── .gitignore            # .env and node_modules
├── package.json          # section 3.2
├── server.js             # section 4 (Part 3: Backend)
├── public/
│   ├── index.html        # section 5.1 – upload page
│   └── share.html        # section 5.2 – download page
└── aws/
    ├── cors.json         # section 2.2 – paste into S3 console (Permissions → CORS)
    ├── cors-cli.json     # same rule wrapped in {"CORSRules": …} for the CLI
    ├── lifecycle.json    # section 2.3
    ├── iam-policy.json   # section 2.4 – paste into IAM → Policies → JSON
    ├── setup-bucket.sh   # sections 2.1–2.3 as CLI commands
    └── verify-identity.sh# section 2.5
```

## Quick start

1. **AWS setup (Part 1).** Either follow the console steps in the guide, or:
   ```bash
   BUCKET=your-unique-bucket REGION=ap-southeast-1 bash aws/setup-bucket.sh
   ```
   Then create the IAM policy from `aws/iam-policy.json` (edit the bucket name),
   create the `tempshare-backend` user, attach the policy and create an access key.
2. **Configure.** Put your key pair, region and bucket in `.env`.
   The shipped values are AWS's documentation examples and will be rejected
   (`InvalidAccessKeyId`) until replaced.
3. **Verify the key:** `bash aws/verify-identity.sh`
4. **Run:**
   ```bash
   npm install
   npm start
   ```
   Open http://localhost:3000 and work through the test checklist in Part 5.

If you change the bucket name or the origin, update it in `.env`,
`aws/iam-policy.json`, `aws/cors.json` / `aws/cors-cli.json` and the
`setup-bucket.sh` call.

**Never commit `.env`.** It is already in `.gitignore`.
