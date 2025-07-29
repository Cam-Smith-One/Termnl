import CryptoJS from "crypto-js"

export function encryptMessage(message: string, key: string): string {
  return CryptoJS.AES.encrypt(message, key).toString()
}

export function decryptMessage(encryptedMessage: string, key: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedMessage, key)
    return bytes.toString(CryptoJS.enc.Utf8)
  } catch (error) {
    console.error("Decryption failed:", error)
    return "[Message could not be decrypted]"
  }
}

export function generateSecureInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""

  // Generate 4 groups of 3 characters each
  for (let group = 0; group < 4; group++) {
    if (group > 0) result += "-"
    for (let i = 0; i < 3; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
  }

  return result
}

export function generateEncryptionKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
