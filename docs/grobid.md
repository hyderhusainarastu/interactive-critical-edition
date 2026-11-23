# Phase 8 local structured extraction

The app defaults to `ANALYSIS_PIPELINE=v1`. To exercise the additive v2
edition pipeline locally, start the free local GROBID service and set the
worker environment to `ANALYSIS_PIPELINE=v2` and `GROBID_URL=http://localhost:8070`:

```sh
docker compose --profile grobid up -d grobid
curl -fsS http://localhost:8070/api/isalive
```

GROBID is deliberately local-only. If it is unset or unavailable, v2 publishes
the clearly labelled `structure-limited` PDF.js page-block fallback; private
uploads are never sent to a public GROBID endpoint.
