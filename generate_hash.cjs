const crypto = require('crypto');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      
      const saltHex = salt.toString('hex');
      const hashHex = derivedKey.toString('hex');
      resolve(`${saltHex}:${hashHex}`);
    });
  });
}

hashPassword('admin123').then(hash => console.log(hash));
