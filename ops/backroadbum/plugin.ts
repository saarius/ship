// Merchant practice profile. No generic Connect, order intake, admission control or postage.
import type { SandboxedPlugin } from 'emdash/plugin';
import { shippingAdmin } from './admin.js';
const plugin: SandboxedPlugin = {
  routes: { admin: { public: false, permission: 'plugins:manage', methods: ['POST'], handler: shippingAdmin } },
};
export default plugin;
