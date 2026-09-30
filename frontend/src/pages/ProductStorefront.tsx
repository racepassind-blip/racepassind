import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRight, Check, Clock3, Minus, Package, PackageCheck, Plus, Ruler, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ProductGallery, ImageLightbox } from "@/components/products/ProductMedia";
import { MerchQrDownload } from "@/components/products/MerchQrDownload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { CITIES_BY_DISTRICT, DISTRICTS_BY_STATE, INDIA_STATES } from "@/data/indiaLocations";

type Variant = { id: string; label: string; price_paise: number; stock: number };
type Product = { active?: boolean; id: string; name: string; description: string; image_ids: string[]; size_chart_image_id: string | null; customization_label: string | null; variants: Variant[] };
type Listing = { id: string; name: string; description: string; status: string; fee_bearer?: "ORGANIZER" | "PARTICIPANT"; price_previews?: Record<string, { participantTotalPaise: number; platformFeePaise: number }>; organizer?: { name: string; logo_url?: string | null }; catalog: { products: Product[]; max_units_per_order: number; fulfillment: "pickup" | "home_delivery"; delivery_address_required?: boolean; pickup_instructions: string }; images: Record<string, string> };
type Cart = Record<string, { quantity: number; customization: string }>;
type Quote = { subtotal_paise: number; platform_fee_paise: number; total_paise: number; fee_bearer: string };
type Order = { id: string; status: string; snapshot: Quote & { payment?: { upiUri: string; qrDataUrl: string; amountPaise: number }; pickup_instructions: string } };

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

export default function ProductStorefront() {
  const { listingId } = useParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [quoteError, setQuoteError] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Cart>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [address, setAddress] = useState({ address: "", state: "", district: "", city: "", pincode: "" });
  const [order, setOrder] = useState<Order | null>(null);
  const [token, setToken] = useState("");
  const [reference, setReference] = useState("");
  const [placing, setPlacing] = useState(false);
  const [sizeChart, setSizeChart] = useState<{ name: string; url: string } | null>(null);
  const lines = useMemo(() => Object.entries(cart).filter(([, item]) => item.quantity > 0).map(([key, item]) => { const [product_id, variant_id] = key.split(":"); return { product_id, variant_id, quantity: item.quantity, customization: item.customization || null }; }), [cart]);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const selected = useMemo(() => lines.map((line) => { const product = listing?.catalog.products.find((item) => item.id === line.product_id); const variant = product?.variants.find((item) => item.id === line.variant_id); return { ...line, product, variant }; }).filter((line) => line.product && line.variant), [lines, listing]);

  useEffect(() => {
    let current = true;
    setLoadError(""); setListing(null); setCart({}); setOrder(null);
    if (listingId) void apiRequest<Listing>(`/products/${listingId}`).then((value) => { if (current) setListing(value); }).catch((error) => { if (current) setLoadError(error instanceof Error ? error.message : "Storefront unavailable."); });
    return () => { current = false; };
  }, [listingId, retry]);
  useEffect(() => {
    let current = true;
    setQuote(null); setQuoteError("");
    if (!listingId || !lines.length) return;
    const timer = window.setTimeout(() => void apiRequest<Quote>(`/products/${listingId}/quote`, { method: "POST", body: JSON.stringify({ lines }) }).then((value) => { if (current) setQuote(value); }).catch((error) => { if (current) setQuoteError(error instanceof Error ? error.message : "Could not update total. Adjust your cart to try again."); }), 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [listingId, lines]);

  if (loadError) return <Layout><div role="alert" className="mx-auto max-w-lg px-6 py-24 text-center"><Package className="mx-auto mb-4 h-9 w-9 text-slate-400" /><h1 className="text-2xl font-semibold">Storefront unavailable</h1><p className="my-4 text-muted-foreground">{loadError}</p><Button onClick={() => setRetry((value) => value + 1)}>Try again</Button></div></Layout>;

  if (!listing) return <Layout><div className="grid min-h-[65vh] place-items-center"><div className="text-center"><Package className="mx-auto mb-3 h-8 w-8 animate-pulse text-primary" /><p className="text-muted-foreground">Opening storefront…</p></div></div></Layout>;

  const change = (product: Product, variant: Variant, delta: number) => { setQuote(null); const key = `${product.id}:${variant.id}`; setCart((current) => { const existing = current[key] ?? { quantity: 0, customization: "" }; const quantity = Math.max(0, Math.min(existing.quantity + delta, variant.stock, listing.catalog.max_units_per_order - units + existing.quantity)); return { ...current, [key]: { ...existing, quantity } }; }); };
  const deliveryRequired = listing.catalog.fulfillment === "home_delivery" || listing.catalog.delivery_address_required;
  const place = async () => { if (!listingId || !quote) return; setPlacing(true); const nextToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); try { const result = await apiRequest<Order>(`/products/${listingId}/orders`, { method: "POST", body: JSON.stringify({ lines, buyer_name: buyer.name, buyer_email: buyer.email, buyer_phone: buyer.phone, delivery_address: address.address, delivery_state: address.state, delivery_district: address.district, delivery_city: address.city, delivery_pincode: address.pincode, request_key: crypto.randomUUID(), access_token: nextToken }) }); setToken(nextToken); setOrder(result); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not place order."); } finally { setPlacing(false); } };
  const submitReference = async () => { if (!order) return; try { const updated = await apiRequest<Order>(`/product-orders/${order.id}/reference`, { method: "POST", headers: { "X-Order-Token": token }, body: JSON.stringify({ reference }) }); setOrder(updated); toast.success("Payment reference submitted for review."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not submit payment reference."); } };
  const initials = (listing.organizer?.name || listing.name).split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  return <Layout><div className="min-h-screen bg-[#f6f7f9] text-slate-950">
    <section className="relative overflow-hidden bg-[#101b35] text-white">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-white to-emerald-500" />
      <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-9 flex items-center gap-3 text-sm text-white/70">
          <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-white/15 bg-white/10 font-bold text-white">{listing.organizer?.logo_url ? <img src={listing.organizer.logo_url} alt="" className="h-full w-full object-contain p-1" /> : initials}</div>
          <div><p className="font-semibold text-white">{listing.organizer?.name || "Organizer storefront"}</p><p>Official SportPass store</p></div>
        </div>
        <div className="max-w-3xl"><p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-orange-400">Shop · Pay · Pick up</p><h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{listing.name}</h1>{listing.description && <p className="mt-5 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">{listing.description}</p>}</div>
      </div>
    </section>

    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
      <section><div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">The collection</p><h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Race-day essentials</h2><p className="mt-2 text-sm text-slate-500">Select a size or option, then set the quantity.</p></div>
        {listing.status !== "published" && <p role="status" className="mb-6 rounded-xl bg-slate-200 p-4 text-sm">Sales are closed. You can still browse the collection.</p>}
        {!listing.catalog.products.some((product) => product.active !== false) && <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">Race merchandise is coming soon. Check back for the collection.</div>}
        <div className="grid gap-6 md:grid-cols-2">{listing.catalog.products.filter((product) => product.active !== false).map((product) => {
          const variant = product.variants.find((item) => item.id === choices[product.id]) ?? product.variants.find((item) => item.stock > 0) ?? product.variants[0];
          const key = `${product.id}:${variant.id}`;
          const item = cart[key] ?? { quantity: 0, customization: "" };
          const soldOut = product.variants.every((option) => option.stock === 0);
          const chart = product.size_chart_image_id && listing.images[product.size_chart_image_id];
          const pricePreview = listing.price_previews?.[variant.id];
          return <article key={product.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ProductGallery name={product.name} ids={product.image_ids} images={listing.images} />
            <div className="space-y-5 p-5 sm:p-6"><div><div className="flex items-start justify-between gap-3"><h3 className="text-xl font-semibold tracking-tight">{product.name}</h3><span className="shrink-0 text-lg font-semibold">{money(variant.price_paise)}</span></div><p className={`mt-2 text-xs font-medium ${soldOut ? "text-slate-400" : "text-emerald-700"}`}>{soldOut ? "Sold out" : `${variant.stock} available in ${variant.label}`}</p>{product.description && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-500">{product.description}</p>}</div>
              {listing.fee_bearer === "PARTICIPANT" && pricePreview && pricePreview.platformFeePaise > 0 && <div className="rounded-xl bg-slate-50 p-3 text-sm"><p>{money(variant.price_paise)} + {money(pricePreview.platformFeePaise)} SportPass fee</p><p className="mt-1 font-semibold">{money(pricePreview.participantTotalPaise)} total for one item</p><p className="mt-1 text-xs text-slate-500">4% of your complete cart, minimum ₹20. Charged once per order; your cart shows the final total.</p></div>}
              <div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Size / option</p>{chart && <button onClick={() => setSizeChart({ name: `${product.name} — Size chart`, url: chart })} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold underline underline-offset-4"><Ruler className="h-4 w-4" />View Size Chart</button>}</div><div className="flex flex-wrap gap-2" role="group" aria-label={`${product.name} size or option`}>{product.variants.map((option) => <button key={option.id} disabled={option.stock === 0} aria-pressed={variant.id === option.id} aria-label={`${option.label}${option.stock === 0 ? " — sold out" : ""}`} onClick={() => setChoices((current) => ({ ...current, [product.id]: option.id }))} className={`min-h-11 min-w-11 rounded-lg border px-3 py-2 text-sm font-medium disabled:border-dashed disabled:bg-slate-50 disabled:text-slate-400 disabled:line-through ${variant.id === option.id && option.stock > 0 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200"}`}>{option.label}{(cart[`${product.id}:${option.id}`]?.quantity ?? 0) > 0 && <span className="ml-1">· {cart[`${product.id}:${option.id}`].quantity}</span>}</button>)}</div></div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-4"><span className="text-sm text-slate-500">{item.quantity ? "In your cart" : "Quantity"}</span><div className="flex h-11 items-center rounded-lg border border-slate-200"><button aria-label={`Remove ${product.name} ${variant.label}`} className="grid h-11 w-11 place-items-center disabled:opacity-30" disabled={!item.quantity || Boolean(order) || placing} onClick={() => change(product, variant, -1)}><Minus className="h-4 w-4" /></button><span aria-live="polite" className="w-8 text-center font-semibold">{item.quantity}</span><button aria-label={`Add ${product.name} ${variant.label}`} className="grid h-11 w-11 place-items-center disabled:opacity-30" disabled={variant.stock <= item.quantity || units >= listing.catalog.max_units_per_order || listing.status !== "published" || Boolean(order) || placing} onClick={() => change(product, variant, 1)}><Plus className="h-4 w-4" /></button></div></div>
              {item.quantity > 0 && product.customization_label && <div><Label htmlFor={`custom-${key}`}>{product.customization_label}</Label><Input id={`custom-${key}`} maxLength={120} disabled={Boolean(order) || placing} className="mt-2" value={item.customization} onChange={(event) => { setQuote(null); setCart((current) => ({ ...current, [key]: { ...item, customization: event.target.value } })); }} /></div>}
            </div></article>;
        })}</div>
      </section>

      <aside className="lg:sticky lg:top-24"><div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60"><div className="bg-[#101b35] p-6 text-white"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400">Your cart</p><h2 className="mt-1 text-2xl font-semibold">{units ? `${units} item${units === 1 ? "" : "s"}` : "Ready when you are"}</h2></div><div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10"><ShoppingBag className="h-5 w-5" /></div></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${Math.min(100, (units / listing.catalog.max_units_per_order) * 100)}%` }} /></div><p className="mt-2 text-xs text-white/60">Maximum {listing.catalog.max_units_per_order} units per order</p></div>
        <div className="p-6">{!order ? <div className="space-y-6">{selected.length ? <div className="space-y-3">{selected.map((line) => <div key={`${line.product_id}:${line.variant_id}`} className="flex justify-between gap-3 text-sm"><div><p className="font-bold text-slate-800">{line.product!.name}</p><p className="text-slate-500">{line.variant!.label} × {line.quantity}</p></div><p className="font-bold">{money(line.variant!.price_paise * line.quantity)}</p></div>)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center"><ShoppingBag className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-3 font-bold text-slate-700">Your cart is empty</p><p className="mt-1 text-sm text-slate-500">Choose an option to get started.</p></div>}
          {units > 0 && <><div className="h-px bg-slate-100" /><div className="space-y-3"><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{deliveryRequired ? "Delivery details" : "Pickup details"}</p><div><Label htmlFor="buyer-name">Name</Label><Input id="buyer-name" autoComplete="name" className="mt-1.5" placeholder="Your full name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></div><div><Label htmlFor="buyer-email">Email</Label><Input id="buyer-email" autoComplete="email" className="mt-1.5" type="email" placeholder="you@example.com" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></div><div><Label htmlFor="buyer-phone">Phone</Label><Input id="buyer-phone" autoComplete="tel" className="mt-1.5" type="tel" inputMode="numeric" placeholder="+91 98765 43210" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /><p className="text-xs text-slate-400">Indian mobile number only.</p></div>{deliveryRequired && <div className="space-y-3 rounded-xl border bg-slate-50 p-4"><div><Label htmlFor="delivery-address">Address</Label><Input id="delivery-address" value={address.address} onChange={(e) => setAddress({ ...address, address: e.target.value })} placeholder="House / flat, street, area" /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="delivery-state">State</Label><select id="delivery-state" className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={address.state} onChange={(e) => setAddress({ address: address.address, state: e.target.value, district: "", city: "", pincode: address.pincode })}><option value="">Select state</option>{INDIA_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></div><div><Label htmlFor="delivery-district">District</Label><select id="delivery-district" className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={address.district} disabled={!address.state} onChange={(e) => setAddress({ ...address, district: e.target.value, city: "" })}><option value="">Select district</option>{(DISTRICTS_BY_STATE[address.state] ?? ["Other"]).map((district) => <option key={district} value={district}>{district}</option>)}</select></div><div><Label htmlFor="delivery-city">City</Label><select id="delivery-city" className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={address.city} disabled={!address.district} onChange={(e) => setAddress({ ...address, city: e.target.value })}><option value="">Select city</option>{(CITIES_BY_DISTRICT[address.district] ?? [address.district || "Other"]).map((city) => <option key={city} value={city}>{city}</option>)}</select></div><div><Label htmlFor="delivery-pincode">Pincode</Label><Input id="delivery-pincode" inputMode="numeric" maxLength={6} value={address.pincode} onChange={(e) => setAddress({ ...address, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="570001" /></div></div></div>}</div></>}
          {units > 0 && !quote && <p role={quoteError ? "alert" : "status"} className="text-sm text-slate-500">{quoteError || "Updating total…"}</p>}
          {quote && <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm"><div className="flex justify-between text-slate-600"><span>Products</span><span>{money(quote.subtotal_paise)}</span></div>{quote.fee_bearer === "buyer" && <div className="flex justify-between text-slate-600"><span>SportPass fee</span><span>{money(quote.platform_fee_paise)}</span></div>}<div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-semibold"><span>Total</span><span>{money(quote.total_paise)}</span></div></div>}
          {units > 0 && <div><Button size="lg" className="w-full rounded-xl text-base font-bold" disabled={!quote || buyer.name.trim().length < 2 || !buyer.email.includes("@") || buyer.phone.trim().length < 7 || placing} onClick={() => void place()}>{placing ? "Reserving items…" : <>Continue to payment <ArrowRight className="ml-2 h-4 w-4" /></>}</Button><p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />Stock is held for 30 minutes after ordering</p></div>}</div> : order.status === "awaiting_payment" ? <div className="space-y-5 text-center"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Complete payment</p><h3 className="mt-1 text-2xl font-semibold">Scan with any UPI app</h3><p className="mt-2 text-sm text-slate-500">Your items are reserved while you pay.</p></div><div className="mx-auto w-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><img src={order.snapshot.payment?.qrDataUrl} alt="UPI payment QR code" className="h-48 w-48" /></div><p className="text-xl font-semibold">{money(order.snapshot.payment?.amountPaise ?? order.snapshot.total_paise)}</p><MerchQrDownload key={order.id} qrDataUrl={order.snapshot.payment?.qrDataUrl} orderId={order.id} /><div className="text-left"><Label>Payment reference / UTR</Label><Input className="mt-1.5" placeholder="Enter after payment" value={reference} onChange={(e) => setReference(e.target.value)} /></div><Button className="w-full rounded-xl" disabled={reference.trim().length < 4} onClick={() => void submitReference()}>I’ve paid — submit reference</Button></div> : <div className="py-4 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100"><Check className="h-8 w-8 text-emerald-700" /></div><h3 className="mt-5 text-2xl font-semibold">Order received</h3><p className="mt-2 text-sm capitalize text-slate-500">Payment status: {order.status.replace(/_/g, " ")}</p><div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-left text-sm leading-6 text-emerald-950"><p className="font-bold">Pickup instructions</p><p>{order.snapshot.pickup_instructions}</p></div></div>}</div></div>
        {order && <div aria-label="Payment breakdown" className="mt-4 space-y-2 rounded-2xl border bg-white p-4 text-sm"><div className="flex justify-between"><span>Products</span><span>{money(order.snapshot.subtotal_paise)}</span></div>{order.snapshot.fee_bearer === "buyer" && order.snapshot.platform_fee_paise > 0 && <div className="flex justify-between"><span>SportPass fee</span><span>{money(order.snapshot.platform_fee_paise)}</span></div>}<div className="flex justify-between border-t pt-2 font-semibold"><span>Payment total</span><span>{money(order.snapshot.total_paise)}</span></div></div>}
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" /><div><p className="font-bold text-slate-800">{deliveryRequired ? "Delivery information" : "Pickup information"}</p><p className="mt-1 leading-5">{listing.catalog.pickup_instructions}</p></div></div>
      </aside>
    </main>
    <ImageLightbox image={sizeChart} onClose={() => setSizeChart(null)} />
  </div></Layout>;
}
