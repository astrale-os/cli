# Clean-slate cleanup tracking

This PR implements the CLI slice of **SDK-06** in the Kernel/SDK clean-slate audit
(`reports/kernel-sdk-clean-slate-audit-20261009` in the Astrale workspace). Its
status is **proposed in this PR**, pending merge and release qualification.

| Finding | Change | Remaining scope |
| --- | --- | --- |
| SDK-06 | Remove the `astrale update` codemod for bare `deploy()` configurations. It wrapped the retired aggregate in `defineProject({ deployment })`, a form the current SDK rejects. Update continues to manage the CLI, skills and dependency versions; it does not rewrite authored project configuration. | SDK removal of `deploy()` and its aggregate, and final consumer cohort qualification. |

Projects use `defineProject({ domain, environments })`, with each environment
receiving an adapter deployment. Author configuration changes explicitly when
adopting that contract.

Fleet catalog provisioning (CT-16), Release discovery (CT-17), Shell/GUI contracts
(CT-18), and 1Pact reconstruction (CT-14) remain separate coordinated work. This
PR does not claim them resolved.
