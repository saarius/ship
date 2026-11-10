// Merchant read-only profile. No generic Connect, order intake or label action is exposed.
import type { SandboxedPlugin } from 'emdash/plugin';
import { shippingAdmin } from './admin.js';
const plugin: SandboxedPlugin = {
  routes: { admin: { public: false, permission: 'plugins:manage', methods: ['POST'], handler: shippingAdmin } },
};
export default plugin;
