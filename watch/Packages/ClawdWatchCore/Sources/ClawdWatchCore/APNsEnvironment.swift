import Foundation
public enum APNsEnvironment {
    // The signed development profile is embedded as CMS data containing a plist.
    // Unknown/missing entitlement disables registration rather than guessing from DEBUG.
    public static func fromProfile(_ data: Data?) -> String? {
        guard let data,
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data[start.lowerBound..<end.upperBound], format: nil) as? [String:Any],
              let entitlements = plist["Entitlements"] as? [String:Any],
              let value = entitlements["aps-environment"] as? String else { return nil }
        switch value { case "development": return "sandbox"; case "production": return "production"; default: return nil }
    }
}
