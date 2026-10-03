import SwiftUI
struct OnboardingView: View {
    @EnvironmentObject private var state: WatchViewState
    @State private var address = Bundle.main.object(forInfoDictionaryKey: "ClawdApprovalGatewayURL") as? String ?? ""
    @State private var code = ""
    @State private var working = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Clawd Watch").font(.headline).foregroundStyle(Theme.Text.primary)
                Text("先在 Mac 桌宠的手表审批设置中生成配对码。").font(.footnote)
                TextField("HTTPS 审批地址", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("六位配对码", text: $code)
                Button(working ? "配对中…" : "配对 Mac") {
                    working = true
                    Task { await state.pair(address: address, code: code); working = false }
                }.disabled(working || code.count != 6 || address.isEmpty)
                Text(state.message).font(.caption).foregroundStyle(.secondary)
                Text("通过手表 Wi-Fi 或蜂窝网络直接连接 Mac。").font(.caption2).foregroundStyle(.secondary)
            }.padding(.horizontal, 4)
        }
    }
}
