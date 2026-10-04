import XCTest
@testable import ClawdWatchCore

final class ApprovalDetailTextTests: XCTestCase {
    func testCommandIsReadableFirstAndOriginalParametersRemainIntact() {
        let raw = #"{"command":"printf 'hello\nworld'","cwd":"/tmp/demo","timeout":1000}"#
        let text = ApprovalDetailText.readable(raw)
        XCTAssertTrue(text.hasPrefix("printf 'hello\nworld'"))
        XCTAssertTrue(text.hasSuffix(raw))
        XCTAssertTrue(text.contains("完整参数"))
    }

    func testUnknownAndNonCommandInputStayExactlyAsReceived() {
        for raw in ["{\n  \"file_path\": \"/tmp/demo\"\n}", "invalid { JSON", "plain\ntext", "", "[1,2]"] {
            XCTAssertEqual(ApprovalDetailText.readable(raw), raw)
        }
    }

    func testPagingDoesNotLoseLongCommandCharactersOrSplitEmoji() {
        let input = "abcdefghijk👨‍👩‍👧‍👦审批xyz"
        let pages = ApprovalDetailText.pages(input, width: 5, linesPerPage: 2) { Double($0.count) }
        XCTAssertEqual(pages.flatMap { $0 }.joined(), input)
        XCTAssertTrue(pages.allSatisfy { $0.count <= 2 })
        XCTAssertTrue(pages.flatMap { $0 }.allSatisfy { $0.count <= 5 })
        XCTAssertEqual(pages[1], ["k👨‍👩‍👧‍👦审批x", "yz"])
    }

    func testMeasuredWideCharactersWrapWithoutClippingOrDroppingBlankLines() {
        let pages = ApprovalDetailText.pages("ab中d\n\n末尾\n", width: 3, linesPerPage: 2) { text in
            text.reduce(0) { $0 + ($1.isASCII ? 1 : 2) }
        }
        XCTAssertEqual(pages, [["ab", "中d"], ["", "末"], ["尾", ""]])
    }

    func testEmptyOrExtremelyNarrowViewportStillHasAUsablePage() {
        XCTAssertEqual(ApprovalDetailText.pages("", width: 0, linesPerPage: 0) { _ in 10 }, [[""]])
        XCTAssertEqual(ApprovalDetailText.pages("中a", width: 1, linesPerPage: 1) { _ in 10 }, [["中"], ["a"]])
    }
}

private extension Character {
    var isASCII: Bool { unicodeScalars.allSatisfy { $0.isASCII } }
}
