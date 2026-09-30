import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProductImage, ImageLightbox } from "@/components/products/ProductMedia";
import { ProductSizeSummary, type InventorySummary } from "@/components/products/ProductSizeSummary";
import { OrderDashboard, StorefrontDirectory, type MerchandiseOrder } from "@/components/products/OrganizerSalesOverview";
import { apiRequest, uploadFile } from "@/lib/api";
import { INDIA_STATES } from "@/data/indiaLocations";

type Organization = { id: string; name: string };
type Variant = { id: string; label: string; price_paise: number; stock: number; options: Record<string, string> };
type Product = { id: string; name: string; description: string; image_ids: string[]; size_chart_image_id: string | null; customization_label: string | null; active: boolean; variants: Variant[] };
type Listing = { id: string; organization_id: string; name: string; description: string; status: string; fee_bearer: "ORGANIZER" | "PARTICIPANT"; upi_id: string; payee_name: string; catalog: { listing_type: "products"; products: Product[]; max_units_per_order: number; fulfillment: "pickup" | "home_delivery"; delivery_address_required?: boolean; pickup_instructions: string }; images: Record<string, string>; has_orders: boolean };
type Order = MerchandiseOrder;
type FeePreview = { amountPaise: number; platformFeePaise: number; customerPaysPaise: number; organizerNetPaise: number; feeBearer: "ORGANIZER" | "PARTICIPANT"; percentageBasisPoints: number; minimumFeePaise: number; maximumFeePaise: number | null };
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);

const uid = () => crypto.randomUUID();
const blankProduct = (): Product => ({ id: uid(), name: "", description: "", image_ids: [], size_chart_image_id: null, customization_label: null, active: true, variants: [{ id: uid(), label: "Standard", price_paise: 0, stock: 1, options: {} }] });

export default function OrganizerProducts() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxUnits, setMaxUnits] = useState(10);
  const [pickup, setPickup] = useState("");
  const [homeDelivery, setHomeDelivery] = useState(false);
  const [feeBearer, setFeeBearer] = useState<"ORGANIZER" | "PARTICIPANT">("ORGANIZER");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [stockBaseline, setStockBaseline] = useState<Record<string, number>>({});
  const [hasOrders, setHasOrders] = useState(false);
  const [savedProductIds, setSavedProductIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [section, setSection] = useState("orders");
  const [creating, setCreating] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [saving, setSaving] = useState(false);
  const [feePreviews, setFeePreviews] = useState<Record<string, FeePreview>>({});
  const [feeError, setFeeError] = useState("");
  const [feeRetry, setFeeRetry] = useState(0);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const pricingKey = JSON.stringify(products.flatMap((product) => product.variants.map((variant) => ({ id: variant.id, amount: variant.price_paise }))));

  const load = async () => {
    setLoadError("");
    const [orgs, all] = await Promise.all([apiRequest<Organization[]>("/organizer/organizations"), apiRequest<Listing[]>("/organizer/product-listings")]);
    setOrganizations(orgs); setListings(all); if (!organizationId) setOrganizationId(orgs[0]?.id ?? "");
    const item = listingId ? all.find((entry) => entry.id === listingId) : null;
    if (listingId && !item) throw new Error("Storefront not found.");
    if (item) { setNumberDrafts({}); setStockBaseline(Object.fromEntries(item.catalog.products.flatMap((product) => product.variants.map((variant) => [variant.id, variant.stock])))); setHasOrders(item.has_orders); setSavedProductIds(item.catalog.products.map((product) => product.id)); setOrganizationId(item.organization_id); setName(item.name); setDescription(item.description); setMaxUnits(item.catalog.max_units_per_order); setPickup(item.catalog.pickup_instructions); setHomeDelivery(item.catalog.fulfillment === "home_delivery" || Boolean(item.catalog.delivery_address_required)); setFeeBearer(item.fee_bearer); setUpiId(item.upi_id); setPayeeName(item.payee_name); setProducts(item.catalog.products); setImages(item.images); setStatus(item.status); setOrders(await apiRequest<Order[]>(`/organizer/product-listings/${item.id}/orders`)); setInventory(await apiRequest<InventorySummary>(`/organizer/product-listings/${item.id}/inventory-summary`)); }
  };
  useEffect(() => {
    setSection((location.state as { openProducts?: boolean } | null)?.openProducts ? "products" : "orders"); setCreating(false); setOrderError(""); setInventory(null);
    if (!listingId) {
      setName(""); setDescription(""); setMaxUnits(10); setPickup(""); setHomeDelivery(false); setFeeBearer("ORGANIZER"); setUpiId(""); setPayeeName(""); setProducts([]); setImages({}); setStatus("draft"); setHasOrders(false); setSavedProductIds([]); setStockBaseline({}); setOrders([]); setFeedback("");
    }
  }, [listingId]);
  useEffect(() => { setLoading(true); void load().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load product sales.")).finally(() => setLoading(false)); }, [listingId]);
  useEffect(() => {
    let current = true;
    setFeePreviews({}); setFeeError("");
    if (!organizationId) return;
    const variants = JSON.parse(pricingKey) as Array<{ id: string; amount: number }>;
    const timer = window.setTimeout(() => {
      void Promise.all([...new Set(variants.map((variant) => variant.amount))].map(async (amount) => [amount, await apiRequest<FeePreview>("/organizer/product-fee-preview", { method: "POST", body: JSON.stringify({ organization_id: organizationId, amount_paise: amount, fee_bearer: feeBearer }) })] as const)).then((entries) => {
        if (!current) return;
        const prices = new Map(entries);
        setFeePreviews(Object.fromEntries(variants.map((variant) => [variant.id, prices.get(variant.amount)!])));
      }).catch(() => { if (current) setFeeError("Could not load pricing. Try again."); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [organizationId, feeBearer, pricingKey, feeRetry]);

  const updateProduct = (id: string, patch: Partial<Product>) => setProducts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const updateVariant = (productId: string, variantId: string, patch: Partial<Variant>) => setProducts((current) => current.map((product) => product.id === productId ? { ...product, variants: product.variants.map((variant) => variant.id === variantId ? { ...variant, ...patch } : variant) } : product));
  const commitVariantNumber = (productId: string, variantId: string, field: "price_paise" | "stock", raw: string) => {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    updateVariant(productId, variantId, field === "price_paise" ? { price_paise: Math.round(value * 100) } : { stock: Math.floor(value) });
    setNumberDrafts((current) => { const next = { ...current }; delete next[`${field}:${variantId}`]; return next; });
  };
  const payload = () => ({ ...(listingId ? { stock_baseline: stockBaseline } : {}), organization_id: organizationId, name, description, fee_bearer: feeBearer, upi_id: upiId, payee_name: payeeName, catalog: { listing_type: "products", products, max_units_per_order: maxUnits, fulfillment: homeDelivery ? "home_delivery" : "pickup", delivery_address_required: homeDelivery, pickup_instructions: pickup } });

  const save = async () => {
    setSaving(true);
    try {
      const item = await apiRequest<Listing>(listingId ? `/organizer/product-listings/${listingId}` : "/organizer/product-listings", { method: listingId ? "PUT" : "POST", body: JSON.stringify(payload()) });
      setFeedback("All changes saved.");
      toast.success(listingId ? "Storefront saved." : "Storefront created. Add products when you're ready.");
      if (!listingId) navigate(`/organizer/products/${item.id}`, { state: { openProducts: true } }); else await load();
    } catch (error) { const message = error instanceof Error ? error.message : "Could not save product listing."; setFeedback(message); toast.error(message); } finally { setSaving(false); }
  };

  const upload = async (file: File, product: Product, kind: "product" | "size") => {
    if (!listingId) { toast.error("Save the listing before uploading images."); return; }
    setUploading(true); setFeedback("Uploading image…");
    try {
      const uploaded = await uploadFile<{ id: string; url: string }>(`/organizer/product-listings/${listingId}/images?product_id=${product.id}&kind=${kind}`, file);
      setImages((current) => ({ ...current, [uploaded.id]: uploaded.url }));
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, ...(kind === "product" ? { image_ids: [...item.image_ids, uploaded.id] } : { size_chart_image_id: uploaded.id }) } : item));
      setFeedback("Image uploaded and saved. Other edits still need Save changes.");
      toast.success(kind === "size" ? "Size chart saved and ready for customers." : "Product photo saved.");
    } catch (error) { const message = error instanceof Error ? error.message : "Upload failed. Please try again."; setFeedback(message); toast.error(message); }
    finally { setUploading(false); }
  };

  const changeStatus = async (next: "published" | "closed") => {
    if (!listingId) return;
    try { await apiRequest(`/organizer/product-listings/${listingId}/status`, { method: "POST", body: JSON.stringify({ status: next }) }); setStatus(next); toast.success(next === "published" ? "Storefront published." : "Sales closed."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update sales status."); }
  };

  const refreshOrders = async () => {
    setOrderBusy(true); setOrderError("");
    try { setOrders(await apiRequest<Order[]>(`/organizer/product-listings/${listingId}/orders`)); setInventory(await apiRequest<InventorySummary>(`/organizer/product-listings/${listingId}/inventory-summary`)); }
    catch (error) { setOrderError(error instanceof Error ? error.message : "Could not refresh orders."); }
    finally { setOrderBusy(false); }
  };
  const decide = async (order: Order, decision: "approve" | "reject" | "fulfilled" | "cancel") => {
    setOrderBusy(true); setOrderError("");
    try {
      const updated = await apiRequest<Pick<Order, "status" | "snapshot" | "payment_reference">>(`/organizer/product-listings/${listingId}/orders/${order.id}`, { method: "POST", body: JSON.stringify({ decision }) });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...updated } : item));
      setInventory(await apiRequest<InventorySummary>(`/organizer/product-listings/${listingId}/inventory-summary`));
      toast.success("Order updated.");
    } catch (error) { setOrderError(error instanceof Error ? error.message : "Could not update order."); }
    finally { setOrderBusy(false); }
  };
  const removeOrder = async (order: Order) => {
    setOrderBusy(true); setOrderError("");
    try { await apiRequest(`/organizer/product-listings/${listingId}/orders/${order.id}`, { method: "DELETE" }); setOrders((current) => current.filter((item) => item.id !== order.id)); toast.success("Order deleted."); }
    catch (error) { setOrderError(error instanceof Error ? error.message : "Could not delete order."); }
    finally { setOrderBusy(false); }
  };
  const notifyCancellation = async (order: Order) => {
    setOrderBusy(true); setOrderError("");
    try { const result = await apiRequest<{ email_status: string }>(`/organizer/product-listings/${listingId}/orders/${order.id}/cancellation-email`, { method: "POST" }); toast.success(result.email_status === "SENT" ? "Cancellation email sent." : "Cancellation email queued."); }
    catch (error) { setOrderError(error instanceof Error ? error.message : "Could not send cancellation email."); }
    finally { setOrderBusy(false); }
  };

  if (loading || loadError) return <OrganizerDashboardLayout><div className="p-12 text-center" role={loadError ? "alert" : "status"}>{loadError || "Loading merchandise studio…"}{loadError && <Button className="ml-4" onClick={() => { setLoading(true); void load().catch((error) => setLoadError(error.message)).finally(() => setLoading(false)); }}>Try again</Button>}</div></OrganizerDashboardLayout>;

  return <OrganizerDashboardLayout><div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
    <div className="overflow-hidden rounded-3xl bg-[#101b35] px-6 py-8 text-white shadow-xl sm:px-8"><div className="flex flex-wrap items-center justify-between gap-5"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-orange-400">Merchandise studio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{listingId ? name : "Your merchandise stores"}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Create a polished pickup shop for race jerseys, apparel, and race-day merchandise.</p></div>{listingId && <div className="flex flex-wrap gap-2">{status !== "draft" && <Button asChild variant="secondary"><Link to={`/products/${listingId}`} target="_blank">View published store</Link></Button>}{status === "published" ? <Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => void changeStatus("closed")}>Close sales</Button> : <Button onClick={() => void changeStatus("published")}>Publish store</Button>}</div>}</div></div>
    {!listingId && <StorefrontDirectory stores={listings} onCreate={() => setCreating(true)} />}
    {listingId && <><Link to="/organizer/products" className="inline-block text-sm text-slate-500 hover:underline">← All storefronts</Link><div role="tablist" aria-label="Store management" className="flex gap-2 border-b pb-3">{[["orders", "Orders"], ["products", "Products"], ["settings", "Settings"]].map(([value, label]) => <Button key={value} role="tab" aria-selected={section === value} variant={section === value ? "default" : "ghost"} onClick={() => setSection(value)}>{label}</Button>)}</div><div hidden={section !== "orders"} className="space-y-6">{inventory?.products && <ProductSizeSummary summary={inventory} />}<OrderDashboard orders={orders} onDecision={decide} onDelete={removeOrder} onNotifyCancellation={notifyCancellation} onRefresh={refreshOrders} busy={orderBusy} error={orderError} /></div></>}
    <div hidden={listingId ? section === "orders" : !creating} className="space-y-6">
    {!listingId && <div className="flex items-center justify-between"><h2 className="text-2xl font-semibold">New storefront</h2><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button></div>}
    {hasOrders && (!listingId || section === "products") && <p className="rounded-xl bg-amber-50 p-4 text-sm">You can update names, photos, size charts and inventory. Existing orders keep their original details. Products and sizes cannot be removed once orders exist; set stock to 0 to stop sales.</p>}
    <fieldset disabled={uploading || saving} className="min-w-0 space-y-6 disabled:opacity-70">
    <div hidden={Boolean(listingId) && section !== "settings"}>
    <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Store details</CardTitle><CardDescription>Give participants the information they need to buy with confidence.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><Label>Organization</Label><Select value={organizationId} onValueChange={setOrganizationId} disabled={Boolean(listingId)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Storefront name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Official race merchandise" /></div><div className="sm:col-span-2"><Label>Short description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What can participants shop here?" /></div><div><Label>Maximum units per transaction</Label><Input type="number" min={1} max={100} value={maxUnits} onChange={(e) => setMaxUnits(Number(e.target.value))} /><p className="mt-1 text-xs text-muted-foreground">Applies across the whole cart.</p></div><div><Label>Pickup instructions</Label><Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Collect at the venue from 8 AM" /></div><label className="flex items-start gap-3 rounded-xl border p-4 sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={homeDelivery} onChange={(e) => setHomeDelivery(e.target.checked)} /><span><span className="block text-sm font-semibold">Collect home delivery address</span><span className="mt-1 block text-xs text-muted-foreground">Customers will provide address, state, district, city, and pincode at checkout.</span></span></label><div><Label>UPI ID</Label><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" /></div><div><Label>Payee name</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></div><div><Label>SportPass fee</Label><Select value={feeBearer} onValueChange={(value) => setFeeBearer(value as typeof feeBearer)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ORGANIZER">Organizer pays</SelectItem><SelectItem value="PARTICIPANT">Buyer pays</SelectItem></SelectContent></Select></div></CardContent></Card>
    </div>
    <div hidden={!listingId || section !== "products"} className="space-y-6">
    {products.length === 0 && <Card className="rounded-3xl border-dashed"><CardContent className="space-y-3 p-8 text-center"><Package className="mx-auto h-8 w-8 text-orange-600" /><h3 className="text-lg font-semibold">No products yet</h3><p className="text-sm text-muted-foreground">Add your first product to start building this storefront.</p><Button onClick={() => setProducts([blankProduct()])}><Plus className="mr-2 h-4 w-4" />Add product</Button></CardContent></Card>}
    {products.map((product, productIndex) => <Card key={product.id} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm"><CardHeader className="bg-slate-50/70"><div className="flex justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Product {productIndex + 1}</p><CardTitle className="mt-1">{product.name || "New race merchandise"}</CardTitle><CardDescription>Add a strong image and clear options so participants can choose quickly.</CardDescription></div><Button aria-label={`Remove product ${productIndex + 1}`} disabled={hasOrders} size="icon" variant="ghost" onClick={() => setProducts((items) => items.filter((item) => item.id !== product.id))}><Trash2 className="h-4 w-4" /></Button></div></CardHeader><CardContent className="space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Product name</Label><Input value={product.name} onChange={(e) => updateProduct(product.id, { name: e.target.value })} placeholder="Race jersey" /></div><div><Label>Customization label (optional)</Label><Input value={product.customization_label ?? ""} onChange={(e) => updateProduct(product.id, { customization_label: e.target.value || null })} placeholder="Printed name" /></div><div className="sm:col-span-2"><Label>Description</Label><Textarea value={product.description} onChange={(e) => updateProduct(product.id, { description: e.target.value })} placeholder="Describe what the buyer receives." /></div></div>{!savedProductIds.includes(product.id) && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Save this product to enable photo and size-chart uploads.</p>}{savedProductIds.includes(product.id) && <div className="grid gap-3 sm:grid-cols-2"><label className="cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-orange-400 hover:bg-orange-50/50"><ImagePlus className="mb-2 h-5 w-5 text-orange-600" /><span className="font-bold">Product image</span><p className="mt-1 text-xs text-muted-foreground">Up to 8 photos. The first photo is the cover; every photo appears in the customer gallery.</p><Input className="mt-3 bg-white" disabled={uploading || saving} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file, product, "product"); }} /></label><label className="cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-orange-400 hover:bg-orange-50/50"><ImagePlus className="mb-2 h-5 w-5 text-orange-600" /><span className="font-bold">Size chart</span><p className="mt-1 text-xs text-muted-foreground">Upload the actual measurements chart. Customers open it beside the size selector. Uploads are saved immediately.</p><Input className="mt-3 bg-white" disabled={uploading || saving} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file, product, "size"); }} /></label></div>}
          <div className="grid gap-6 sm:grid-cols-2"><div><p className="mb-3 text-sm font-medium">Customer gallery · {product.image_ids.length}/8 photos</p><div className="flex flex-wrap gap-3">{product.image_ids.map((id, index) => <div key={id} className="w-24"><button type="button" aria-label={`Preview ${product.name} photo ${index + 1}`} className="h-24 w-24 overflow-hidden rounded-xl border" onClick={() => setPreview({ name: product.name || "Product photo", url: images[id] })}><ProductImage src={images[id]} alt={`Photo ${index + 1}`} className="h-full w-full object-contain" /></button><p className="mt-1 text-xs text-slate-500">{index === 0 ? "Cover photo" : `Photo ${index + 1}`}</p><button type="button" className="mt-1 text-xs underline" onClick={() => updateProduct(product.id, { image_ids: product.image_ids.filter((imageId) => imageId !== id) })}>Remove</button></div>)}</div></div><div><p className="mb-3 text-sm font-medium">Size chart · customer preview</p>{product.size_chart_image_id ? <><button type="button" className="h-40 w-full overflow-hidden rounded-xl border bg-white p-2" onClick={() => setPreview({ name: `${product.name} — Size chart`, url: images[product.size_chart_image_id!] })}><ProductImage src={images[product.size_chart_image_id]} alt={`${product.name} size chart`} className="h-full w-full object-contain" /></button><button type="button" className="mt-2 text-xs underline" onClick={() => updateProduct(product.id, { size_chart_image_id: null })}>Remove size chart</button></> : <p className="rounded-xl border border-dashed p-6 text-sm text-slate-400">No size chart uploaded yet.</p>}</div></div>
          <div className="space-y-3">
            <div><h3 className="font-semibold">Sizes, pricing & stock</h3><p className="mt-1 text-sm text-slate-500">Set a price and available quantity for each size. Use labels like S, M, or M / Navy.</p></div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-medium">How much do you want to charge?</p>
              <p className="mt-1 text-slate-600">{feeBearer === "ORGANIZER" ? "Enter your selling price below. The customer pays that amount directly to your UPI account. You pay the SportPass fee from your credits." : "Enter your selling price below. We add the SportPass fee to the customer's total. The full payment goes to your UPI account, then the fee comes from your credits."}</p>
              <p className="mt-2 text-xs text-slate-500">4% per complete order · ₹20 minimum · No maximum. Previews below assume one item purchased alone; fees are not charged separately per size.</p>
            </div>
            {feeError && <p role="alert" className="text-sm text-red-700">{feeError} <button type="button" className="underline" onClick={() => setFeeRetry((value) => value + 1)}>Retry pricing</button></p>}
            {product.variants.map((variant) => {
              const candidate = feePreviews[variant.id];
              const preview = candidate?.amountPaise === variant.price_paise && candidate?.feeBearer === feeBearer ? candidate : undefined;
              return <div key={variant.id} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="grid gap-4 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <div><Label htmlFor={`size-${variant.id}`}>Option / size</Label><Input id={`size-${variant.id}`} className="mt-2" placeholder="M / Navy" value={variant.label} onChange={(e) => updateVariant(product.id, variant.id, { label: e.target.value })} /></div>
                  <div><Label htmlFor={`price-${variant.id}`}>Your selling price (₹)</Label><Input id={`price-${variant.id}`} className="mt-2" type="number" min={0} step="0.01" value={numberDrafts[`price_paise:${variant.id}`] ?? String(variant.price_paise / 100)} onChange={(e) => { const raw = e.target.value; setNumberDrafts((current) => ({ ...current, [`price_paise:${variant.id}`]: raw })); if (raw !== "") updateVariant(product.id, variant.id, { price_paise: Math.round(Math.max(0, Number(raw)) * 100) }); }} onBlur={(e) => commitVariantNumber(product.id, variant.id, "price_paise", e.target.value)} /></div>
                  <div><Label htmlFor={`stock-${variant.id}`}>Available stock</Label><Input id={`stock-${variant.id}`} className="mt-2" type="number" min={0} step={1} value={numberDrafts[`stock:${variant.id}`] ?? String(variant.stock)} onChange={(e) => { const raw = e.target.value; setNumberDrafts((current) => ({ ...current, [`stock:${variant.id}`]: raw })); if (raw !== "") updateVariant(product.id, variant.id, { stock: Math.floor(Math.max(0, Number(raw))) }); }} onBlur={(e) => commitVariantNumber(product.id, variant.id, "stock", e.target.value)} /><p className="mt-1 text-xs text-slate-500">{variant.stock === 0 ? "Sold out — customers cannot select this option." : "Set to 0 to mark sold out."}</p></div>
                  <Button className="sm:mt-7" variant="ghost" aria-label={`Remove size ${variant.label}`} disabled={hasOrders || product.variants.length === 1} onClick={() => updateProduct(product.id, { variants: product.variants.filter((item) => item.id !== variant.id) })}>Remove</Button>
                </div>
                <div className="border-t bg-slate-50/70 px-4 py-3">
                  <p className="mb-2 text-xs text-slate-500">One-item order preview</p>
                  {preview ? <div className="space-y-3"><dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{[["Customer pays to your UPI", preview.customerPaysPaise], ["SportPass deducts from credits", preview.platformFeePaise]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{money(value as number)}</dd></div>)}</dl><p className="text-sm text-slate-600">{money(preview.platformFeePaise)} is deducted from your SportPass credits only when you approve the payment. Your earnings after this fee: <strong className="font-semibold text-slate-900">{money(preview.organizerNetPaise)}</strong>.</p></div> : <p role="status" className="text-sm text-slate-500">{feeError ? "Preview unavailable" : organizationId ? "Updating price…" : "Select an organization to preview pricing."}</p>}
                </div>
              </div>;
            })}
            <p className="text-xs text-slate-500">Stock changes preserve orders placed while you edit.</p>
            <Button variant="outline" onClick={() => updateProduct(product.id, { variants: [...product.variants, { id: uid(), label: "", price_paise: 0, stock: 1, options: {} }] })}><Plus className="mr-2 h-4 w-4" />Add size / option</Button>
          </div></CardContent></Card>)}
    </div>
    </fieldset>
    <p role="status" className="text-sm text-slate-600">{feedback}</p>
    <div className="sticky bottom-0 z-10 flex flex-wrap justify-between gap-3 rounded-xl border bg-white/95 p-4 shadow-sm">{listingId && section === "products" && <Button disabled={saving || uploading} variant="outline" onClick={() => setProducts((items) => [...items, blankProduct()])}><Package className="mr-2 h-4 w-4" />Add product</Button>}<Button className="ml-auto" disabled={saving || uploading} onClick={() => void save()}>{saving ? "Saving…" : listingId ? "Save changes" : "Create storefront"}</Button></div>
    </div>
    <ImageLightbox image={preview} onClose={() => setPreview(null)} />
  </div></OrganizerDashboardLayout>;
}
