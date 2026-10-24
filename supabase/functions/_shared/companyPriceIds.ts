// Stripe prices for the 2026-10 company plans. Test mode and live mode hold different price ids, so every caller picks
// the map for the key's mode with companyPriceIds(). Pure, no imports, so vitest can run it.
export const COMPANY_PRICE_IDS = {
  month: { core: 'price_1URZ3vLSrCwArzdgiivKh45q', scout: 'price_1URZ4NLSrCwArzdgTRNtzLTN', manager: 'price_1URZ4hLSrCwArzdgqFoo7OnD', field: 'price_1URZ55LSrCwArzdgh7vbiLMt', dma: 'price_1URZ5RLSrCwArzdgOfauj33H' },
  year: { core: 'price_1URZ7gLSrCwArzdg79O0Saii', scout: 'price_1URZ8WLSrCwArzdgcOdcah9e', manager: 'price_1URZ8rLSrCwArzdgiLWhBVSe', field: 'price_1URZ9BLSrCwArzdgYdgTCgEn', dma: 'price_1URZ9TLSrCwArzdgfFbGB1ey' },
} as const;

// Live-mode copies (created 2026-10-21, lookup keys tc2026_<product>_<interval>).
export const COMPANY_PRICE_IDS_LIVE = {
  month: { core: 'price_1UT1M2LSrCwArzdgAaDArg8n', scout: 'price_1UT1McLSrCwArzdgy7PTRcGE', manager: 'price_1UT1MyLSrCwArzdgIPfiwIAw', field: 'price_1UT1NILSrCwArzdgA4JGKq6m', dma: 'price_1UT1NdLSrCwArzdgylRCa328' },
  year: { core: 'price_1UT1MMLSrCwArzdgdJbet835', scout: 'price_1UT1MnLSrCwArzdgLF5kShF7', manager: 'price_1UT1N8LSrCwArzdg99IxN4su', field: 'price_1UT1NTLSrCwArzdgghWH934y', dma: 'price_1UT1NmLSrCwArzdg0tj13dLT' },
} as const;

export type CompanyPriceIds = typeof COMPANY_PRICE_IDS | typeof COMPANY_PRICE_IDS_LIVE;

/** The price map for the Stripe key's mode: live prices on a live key, test prices on a test key. */
export function companyPriceIds(live: boolean): CompanyPriceIds {
  return live ? COMPANY_PRICE_IDS_LIVE : COMPANY_PRICE_IDS;
}
