<!-- "More details" / "Deep reasoning" on a "tell me about yourself / your
experience" answer: attaches each project's existing architecture entries
(include:, no copied facts) only on the expansion click (when: expansion),
so the first answer costs nothing extra. One entry per profile. -->

## Career walkthrough — architecture of my projects
id: career-arch-fe
profiles: frontend
when: expansion
cap: 13000
keys: !about yourself, !your experience, !walk me through your resume, !your background, !what have you done, !your career
include: gora-fe-summary, gora-bip-architecture, gora-fe-react-native, speeqr-architecture-fe, ecommerce-stack, upaisa-summary
- Main projects (most depth): Rakuten GORA customer booking platform, GORA Business Innovation Portal, GORA React Native app, Speeqr. Shorter: fintech apps, Winkelstraat.nl storefront, uPaisa.

## Career walkthrough — architecture of my projects
id: career-arch-android
profiles: android
when: expansion
cap: 13000
keys: !about yourself, !your experience, !walk me through your resume, !your background, !what have you done, !your career
include: gora-summary, speeqr-architecture-android, upaisa-summary
- Main projects (most depth): Rakuten GORA Android app, Speeqr Android client. Shorter: fintech apps, uPaisa, retail apps.

## Career walkthrough — architecture of my projects
id: career-arch-fullstack
profiles: fullstack
when: expansion
cap: 13000
keys: !about yourself, !your experience, !walk me through your resume, !your background, !what have you done, !your career
include: gora-fe-summary, gora-summary, gora-rails-services, speeqr-architecture-backend, ecommerce-stack, upaisa-summary
- Main projects (most depth): Rakuten GORA web and mobile apps with the Rails booking services, Speeqr (Android client and Rails backend). Shorter: fintech apps, Winkelstraat.nl storefront, uPaisa.
