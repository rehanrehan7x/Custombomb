# ThumbGrab – Blog CMS + YouTube Transcript

## Transcript setup

The transcript tool uses a production transcript provider when `TRANSCRIPT_API_KEY` is configured. It requests caption-based transcripts first and enables ASR fallback for videos without accessible captions. ASR jobs may take longer because they are processed asynchronously.

Set this environment variable in your hosting dashboard:

```text
TRANSCRIPT_API_KEY=your_api_key_here
```

Keep the key server-side. Do not put it in frontend JavaScript.

The app also keeps the existing `youtube-transcript` extractor as a fallback for caption-only cases.

## Existing environment variables

```text
MONGODB_URI=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
TRANSCRIPT_API_KEY=...
```

## SEO

Transcript page:

`/youtube-transcript.html`

Includes title, description, keywords, canonical URL, Open Graph metadata, WebApplication structured data and FAQ structured data.
