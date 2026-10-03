import XCTest
@testable import ClawdWatchCore
final class APNsEnvironmentTests: XCTestCase {
    func testRegistrationUsesProvisioningEntitlementAndFailsClosedWhenUnknown() {
        for (value, expected) in [("development", "sandbox"), ("production", "production")] {
            let xml = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Entitlements</key><dict><key>aps-environment</key><string>\(value)</string></dict></dict></plist>"
            let profile = Data([0,1,2]) + Data(xml.utf8) + Data([0,3])
            XCTAssertEqual(APNsEnvironment.fromProfile(profile), expected)
        }
        XCTAssertNil(APNsEnvironment.fromProfile(nil))
        XCTAssertNil(APNsEnvironment.fromProfile(Data("garbage".utf8)))
    }
}
