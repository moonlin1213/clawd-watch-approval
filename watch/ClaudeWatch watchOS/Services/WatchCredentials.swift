import Foundation
import Security
import ClawdWatchCore

enum WatchCredentials {
    private static let service = "org.example.clawdwatch.device"
    private static let account = "identity"
    private static var query: [String: Any] { [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:account] }
    static func load() -> WatchIdentity? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(WatchIdentity.self, from: data)
    }
    static func save(_ identity: WatchIdentity) throws {
        let data = try JSONEncoder().encode(identity)
        let attributes: [String:Any] = [kSecValueData as String:data, kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; attributes.forEach { q[$0.key] = $0.value }
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw ApprovalAPIError.invalidResponse }
        } else if status != errSecSuccess { throw ApprovalAPIError.invalidResponse }
    }
    static func remove() { SecItemDelete(query as CFDictionary) }
}
