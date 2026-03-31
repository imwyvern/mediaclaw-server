module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'mediaclaw-web',
      cwd: __dirname,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
        HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
      },
    },
  ],
}
