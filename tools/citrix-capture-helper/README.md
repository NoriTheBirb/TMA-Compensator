# Citrix Capture Helper

Small local HTTP service that captures a desktop screenshot (including Citrix Workspace windows) and returns it to the web app.

## Why
Browsers cannot capture other applications / the full desktop for security reasons. For Citrix, UI automation usually can’t see inside the remote session, so the practical path is:

1. Web app triggers capture
2. Local helper screenshots desktop
3. OCR + parsing extracts required fields (done either in the helper or in the web app)

This helper implements step (2).

## Run
From repo root:

- Install: `npm.cmd --prefix tools/citrix-capture-helper install`
- Start: `npm.cmd --prefix tools/citrix-capture-helper start`

It listens on `http://127.0.0.1:3177`.

## API
- `GET /health`
- `POST /capture` body: `{ "screen": 0 }` (optional)
  - returns `{ ok, mime: "image/png", pngBase64 }`

## Next step
In the Angular app, decode `pngBase64` into an `<img>`/`canvas`, crop the regions for:
- the `SGSS...` code
- the value under `Tipo Empresa`

…and then OCR those crops.
