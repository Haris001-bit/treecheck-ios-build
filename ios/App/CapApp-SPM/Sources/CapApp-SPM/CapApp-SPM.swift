import RevenuecatPurchasesCapacitor

// CapApp-SPM entry — Capacitor CLI may rewrite this file on sync.
// Keep a hard reference so the Purchases plugin is not stripped from the binary.
public let isCapacitorApp = true

// No Void global with a closure initializer here: Swift's optimizer (DeadFunctionAndGlobalElimination) crashes
// on it in Release builds with Xcode 26.0.1 and 26.6. The function below holds the same hard reference, and
// TreecheckIap creates PurchasesPlugin() directly, so the class can't be stripped either way.
public func treecheckWarmIapPlugins() {
  _ = isCapacitorApp
  _ = PurchasesPlugin.self
}
