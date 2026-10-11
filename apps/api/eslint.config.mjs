import typescript from "eslint-config-next/typescript";

// Reuse the workspace's existing TypeScript ESLint configuration.
export default [...typescript, { ignores: ["dist/**"] }];
