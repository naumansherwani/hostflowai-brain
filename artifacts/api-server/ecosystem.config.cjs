module.exports = {
  apps: [
    {
      name: "hostflowai-brain",
      script: "/opt/hostflowai-brain/backend/dist/index.mjs",
      node_args: "--enable-source-maps",
      env_file: "/opt/hostflowai-brain/.env",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
