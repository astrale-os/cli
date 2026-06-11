
## X. Estate finale + releases (2026-06-11 ~17h)

97. 🟩 Estate FINALE : host canary3 (image logs-enabled main-ce51c454f57e,
    guardrail + runner immortel + SELF + shim de logs) ; instance polish1 ;
    polish-app déployée — ui/welcome/meta/jwks 200, notes ok. canary2 +
    alpha-check/alpha-gate détruits.
98. 🟩 CLI release canary BUILT (run 27355791773) : `astrale logs`, timeouts
    240s create/delete, @self lazy. Image host idem.
99. 🟦 Bloqué sur Bryan (2 commandes) : (a) reinstall schéma admin live —
    `astrale instance install https://admin.astrale.ai -i admin --timeout 240000`
    (active Service.logs + maxInstances ; classifier exige sa main sur le
    control plane) ; (b) publish npm — `sh scripts/publish-npmjs.sh`
    (sdk 0.1.5 selfKernel-views, adapter 0.1.7, create 0.1.4, devkit 0.1.5).
    Ensuite : gate froid #3 (logs + guestbook one-shot) pour la boucle polish.
