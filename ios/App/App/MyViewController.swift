import UIKit
import Capacitor
import CapApp_SPM

/**
 * Custom bridge VC so RevenueCat Purchases is always registered.
 * Capacitor SPM packageClassList + NSClassFromString often misses PurchasesPlugin.
 */
class MyViewController: CAPBridgeViewController {
  override open func capacitorDidLoad() {
    super.capacitorDidLoad()
    let ok = TreecheckIap.registerPurchases(on: bridge)
    print("⚡️ [MyViewController] Purchases register ok=\(ok)")
  }
}
