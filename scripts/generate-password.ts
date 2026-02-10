// Generate PBKDF2 password hash for admin user
// Usage: npx tsx scripts/generate-password.ts <password>

async function hashPassword(password: string): Promise<string> {
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

const password = process.argv[2] || 'admin123'
console.log(`Generating hash for password: ${password}`)

hashPassword(password).then(hash => {
  console.log(`\nPassword hash:\n${hash}`)
  console.log(`\nSQL Update command:\nUPDATE users SET password_hash = '${hash}' WHERE email = 'admin@animato.be';`)
})
