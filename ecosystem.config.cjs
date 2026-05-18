module.exports = {
  apps: [
    {
      name: 'wikikai',
      script: 'dist/index.js',
      cwd: __dirname,
      interpreter: `${process.env.HOME}/.nvm/versions/node/v25.6.1/bin/node`,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      time: true,
    },
  ],
};
