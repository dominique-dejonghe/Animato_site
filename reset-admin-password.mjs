// Reset admin password in production database
// Uses exact same crypto implementation as the app

async function hashPassword(password) {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordData = encoder.encode(password)

  const key = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  )

  const hashArray = new Uint8Array(hashBuffer)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')

  return `${saltHex}:${hashHex}`
}

const newHash = await hashPassword('admin123')
console.log('New password hash for admin123:')
console.log(newHash)
console.log('')
console.log('Run this command to update the production database:')
console.log(`npx wrangler d1 execute animato-production --command="UPDATE users SET password_hash = '${newHash}' WHERE email = 'admin@animato.be';"`)
