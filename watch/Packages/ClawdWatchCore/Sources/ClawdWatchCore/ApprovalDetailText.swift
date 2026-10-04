import Foundation

public enum ApprovalDetailText {
    /// Show a shell command before the JSON envelope, while keeping every original parameter.
    public static func readable(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let command = object["command"] as? String, !command.isEmpty else { return raw }
        return command + "\n\n完整参数\n" + raw
    }

    /// Wrap by the actual font measurement. Never split a grapheme or discard whitespace.
    public static func pages(_ text: String, width: Double, linesPerPage: Int,
                             measure: (String) -> Double) -> [[String]] {
        var lines: [String] = []
        for logicalLine in text.components(separatedBy: "\n") {
            var line = ""
            for character in logicalLine {
                let next = line + String(character)
                if !line.isEmpty && measure(next) > max(0, width) {
                    lines.append(line)
                    line = String(character)
                } else { line = next }
            }
            lines.append(line)
        }
        let count = max(1, linesPerPage)
        return stride(from: 0, to: lines.count, by: count).map {
            Array(lines[$0..<min($0 + count, lines.count)])
        }
    }
}
