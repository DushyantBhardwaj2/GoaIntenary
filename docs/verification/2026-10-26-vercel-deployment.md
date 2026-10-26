# Vercel website deployment — 26 October 2026

The repository is [DushyantBhardwaj2/GoaIntenary](https://github.com/DushyantBhardwaj2/GoaIntenary). The Vercel project `goa-intenary` belongs to Dushyant's `dushyant2` Hobby workspace, imports `main`, uses `apps/web` as its root, and serves [goa-intenary.vercel.app](https://goa-intenary.vercel.app/). AWS development APIs remain separate from Vercel.

## Checks

| Check | Result |
| --- | --- |
| GitHub Actions for `7ca2841` | [Succeeded](https://github.com/DushyantBhardwaj2/GoaIntenary/actions/runs/40294988479). |
| Web build and tests | Local production build passed; 15 web tests passed. |
| Core tests | 108 passed locally after updating the migration history expectation to include migration 004. |
| Vercel production redeployment | [Ready](https://vercel.com/dushyant2/goa-intenary/8GcYGPCvk2cBtDkkkkRpwqAsGL69) (`f3790ec`), with `APP_ORIGIN=https://goa-intenary.vercel.app`. |
| Public home | Loaded in a live browser and verified; new favicon and apple-touch icons active. |
| Explore | Received 16 reviewed Goa places and 16 corresponding map pins from the deployed discovery API. |
| My trips | Redirected unauthenticated visitor to the sign-in flow. |

The Vercel project has `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `CORE_API_URL`, `DISCOVERY_API_URL`, and `ENABLE_LOCAL_DEMO=false` in Production and Preview. `APP_ORIGIN` is set for Production only because preview domains vary. Values and credentials are not recorded here.

## Release boundary

Public Cognito signup remains disabled. The web page shows account creation, but new visitor registration cannot complete until the separate signup decision, distributed rate limit and email delivery checks are done. Private trip creation, invited-member access, expense flows and phone layout were not exercised through this deployed website in this verification. The AWS backends passed their earlier cloud integration checks; this browser check does not replace the end-to-end release gate. The AWS database may need a retry after idle resume.
