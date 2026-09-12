module.exports = {
  apps: [
    {
      name: 'vitalscan-worker',
      script: 'npm',
      args: 'run worker',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
