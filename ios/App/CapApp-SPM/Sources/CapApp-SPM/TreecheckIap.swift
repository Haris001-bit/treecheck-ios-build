import Capacitor
import RevenuecatPurchasesCapacitor

/// Registers RevenueCat with the Capacitor bridge (SPM auto-discovery often misses it).
public enum TreecheckIap {
  @discardableResult
  public static func registerPurchases(on bridge: CAPBridgeProtocol?) -> Bool {
    treecheckWarmIapPlugins()

    guard let bridge else {
      print("⚡️ [TreecheckIap] bridge is nil — cannot register Purchases")
      return false
    }

    // Already registered by packageClassList — do not override (avoids duplicate JS headers).
    if bridge.plugin(withName: "Purchases") != nil {
      print("⚡️ [TreecheckIap] Purchases already registered — skipping override")
      return true
    }

    if NSClassFromString("PurchasesPlugin") == nil {
      print("⚡️ [TreecheckIap] PurchasesPlugin not in ObjC runtime yet; registering instance")
    }

    bridge.registerPluginInstance(PurchasesPlugin())

    let loaded = bridge.plugin(withName: "Purchases") != nil
    print("⚡️ [TreecheckIap] Purchases registered=\(loaded)")
    return loaded
  }
}
