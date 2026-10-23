export interface PublicMenu {
  tenant: {
    slug: string;
    name: string;
    description: string;
    address: string;
    whatsapp_phone: string;
    logo_url: string | null;
    cover_url: string | null;
    primary_color: string;
    secondary_color: string;
    timezone: string;
  };
  status: { open: boolean; manual_status: string; hours: { weekday: number; opens: string; closes: string }[] };
  ordering: {
    delivery_enabled: boolean;
    pickup_enabled: boolean;
    delivery_eta_minutes: number;
    pickup_eta_minutes: number;
    min_order_cents: number;
    half_half_pricing: 'highest' | 'average';
    payment_methods: { id: string; label: string }[];
    pix_key: string | null;
    pix_key_holder: string | null;
  };
  zones: { id: string; name: string; fee_cents: number; neighborhoods: string[]; min_order_cents: number | null; eta_minutes: number | null }[];
  menu: {
    categories: { id: string; name: string; kind: 'pizza' | 'product' }[];
    sizes: { id: string; name: string; slices: number; max_flavors: number }[];
    flavors: Flavor[];
    crusts: { id: string; name: string; available: boolean; prices: Record<string, number> }[];
    products: Product[];
    addons: { id: string; name: string; price_cents: number; applies_to: 'pizza' | 'product' | 'all'; available: boolean }[];
  };
}

export interface Flavor {
  id: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  available: boolean;
  prices: Record<string, number>;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  available: boolean;
}

export interface Quote {
  items: { name: string; description: string; quantity: number; unit_price_cents: number; total_cents: number }[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  min_order_cents: number;
  coupon: { code: string } | null;
  coupon_error: string | null;
  eta_minutes: number;
}
