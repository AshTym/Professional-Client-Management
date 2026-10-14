import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'wouter';
import { ArrowRight, Check, ChevronRight, CircleAlert, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useSubmitContactInquiry } from '@workspace/api-client-react';
import type { ContactInquiryInput } from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';

const publicSiteUrl = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, '');

function usePublicMeta(title: string, description: string, route: string) {
  useEffect(() => {
    const originalTitle = document.title;
    const metaSelectors = [
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
      'link[rel="canonical"]',
      'meta[property="og:url"]',
    ];
    const originalMeta = metaSelectors.map((selector) => ({
      selector,
      value: document.head.querySelector<HTMLElement>(selector)?.getAttribute(
        selector.startsWith('link') ? 'href' : 'content',
      ) ?? null,
    }));
    document.title = title;
    const setMeta = (selector: string, attribute: 'content' | 'href', value: string | null) => {
      let element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (!value) {
        element?.remove();
        return;
      }
      if (!element) {
        const isLink = selector.startsWith('link');
        element = document.createElement(isLink ? 'link' : 'meta') as HTMLMetaElement | HTMLLinkElement;
        if (selector.includes('property="og:')) element.setAttribute('property', selector.match(/property="([^"]+)"/)?.[1] || '');
        else if (selector.includes('name="')) element.setAttribute('name', selector.match(/name="([^"]+)"/)?.[1] || '');
        else if (selector.includes('rel="')) element.setAttribute('rel', selector.match(/rel="([^"]+)"/)?.[1] || '');
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };

    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('link[rel="canonical"]', 'href', publicSiteUrl ? `${publicSiteUrl}${route}` : null);
    setMeta('meta[property="og:url"]', 'content', publicSiteUrl ? `${publicSiteUrl}${route}` : null);
    return () => {
      document.title = originalTitle;
      originalMeta.forEach(({ selector, value }) => {
        const element = document.head.querySelector<HTMLElement>(selector);
        if (value === null) element?.remove();
        else element?.setAttribute(selector.startsWith('link') ? 'href' : 'content', value);
      });
    };
  }, [description, route, title]);
}

function PublicHeader({ current }: { current: 'pricing' | 'contact' }) {
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Link href="/" className="public-brand" data-testid="link-public-brand">
          <span className="public-brand-mark"><ShieldCheck aria-hidden="true" /></span>
          <span className="serif">ClientGuard</span>
        </Link>
        <nav className="public-nav" aria-label="Public navigation">
          <Link href="/pricing" aria-current={current === 'pricing' ? 'page' : undefined} data-testid="link-public-pricing">Pricing</Link>
          <Link href="/contact" aria-current={current === 'contact' ? 'page' : undefined} data-testid="link-public-contact">Contact</Link>
          <Link href="/sign-in" className="public-sign-in" data-testid="link-public-sign-in">Sign in</Link>
          <Link href="/sign-up" className="public-nav-cta" data-testid="link-public-start">Get started <ArrowRight aria-hidden="true" /></Link>
        </nav>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <Link href="/" className="public-footer-brand" data-testid="link-footer-home">ClientGuard</Link>
      <span data-testid="text-footer-description">A careful workspace for professional relationships.</span>
      <nav aria-label="Footer navigation">
        <Link href="/pricing" data-testid="link-footer-pricing">Pricing</Link>
        <Link href="/contact" data-testid="link-footer-contact">Contact</Link>
      </nav>
    </footer>
  );
}

export function PricingPage() {
  usePublicMeta(
    'ClientGuard pricing — clear, considered, and in Australian dollars',
    'Simple ClientGuard pricing for Australian law firms and financial-service providers: one client and one matter are free, then AU$15 per client per month.',
    '/pricing',
  );

  return (
    <main className="public-page grain" data-testid="page-pricing">
      <PublicHeader current="pricing" />
      <section className="public-hero pricing-hero page-in">
        <div className="public-hero-copy">
          <div className="public-eyebrow"><span />STRAIGHTFORWARD BY DESIGN</div>
          <h1 className="serif" data-testid="text-pricing-title">Pricing with room to <em>begin.</em></h1>
          <p className="public-lede" data-testid="text-pricing-intro">Start with one client and one matter at no cost. As your client relationships grow, the price stays simple and visible.</p>
          <div className="public-trust-line"><LockKeyhole aria-hidden="true" /><span>For Australian law firms and financial-service providers</span></div>
        </div>
        <div className="pricing-card" data-testid="card-pricing">
          <div className="pricing-card-top">
            <span className="pricing-label">CLIENTGUARD PRICING</span>
            <span className="pricing-status"><span />Clear, in AUD</span>
          </div>
          <div className="price-free"><span className="serif">Free</span><span>One client<br />and one matter</span></div>
          <div className="price-divider"><span>AS YOUR FIRM GROWS</span></div>
          <div className="price-paid"><span className="price-currency">AU$</span><span className="serif price-number">15</span><span className="price-unit">per client<br />per month</span></div>
          <p className="pricing-qualifier">For firms with two or more clients.</p>
          <Link href="/contact" className="pricing-contact-link" data-testid="link-pricing-contact">Questions about pricing? Talk with us <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className="pricing-orbit orbit-one" aria-hidden="true" />
        <div className="pricing-orbit orbit-two" aria-hidden="true" />
      </section>
      <section className="pricing-detail">
        <div className="pricing-detail-heading">
          <div className="public-eyebrow"><span />A CLEAR STARTING POINT</div>
          <h2 className="serif" data-testid="text-pricing-detail-title">One simple way to price your workspace.</h2>
        </div>
        <div className="pricing-detail-body">
          <p data-testid="text-pricing-detail-copy">Your first client and first matter are free. Once your firm has two or more clients, pricing is AU$15 per client, per month.</p>
          <div className="pricing-note" data-testid="notice-pricing-informational"><Check aria-hidden="true" /><p>This page is informational only. There is no checkout or billing process here, and pricing does not describe feature gates or access restrictions.</p></div>
        </div>
      </section>
      <section className="public-cta-band">
        <div><span className="public-eyebrow">A CONSIDERED PLACE TO WORK</span><h2 className="serif">See whether ClientGuard fits your practice.</h2></div>
        <Link href="/contact" className="public-cta-button" data-testid="link-pricing-contact-cta">Start a conversation <ArrowRight aria-hidden="true" /></Link>
      </section>
      <PublicFooter />
    </main>
  );
}

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(120, 'Please keep your name under 120 characters.'),
  email: z.string().trim().min(1, 'Please enter your email address.').email('Enter a valid email address.').max(254, 'Email address is too long.'),
  organization: z.string().trim().max(160, 'Please keep your organization under 160 characters.').optional(),
  message: z.string().trim().min(1, 'Please enter a message.').max(4000, 'Please keep your message under 4,000 characters.'),
  website: z.string().max(255).optional(),
});

export function ContactPage() {
  usePublicMeta(
    'Contact ClientGuard — start a conversation',
    'Talk with the ClientGuard team about a careful client and matter workspace for your Australian law firm or financial-services practice.',
    '/contact',
  );
  const submitInquiry = useSubmitContactInquiry();
  const form = useForm<ContactInquiryInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', email: '', organization: '', message: '', website: '' },
  });

  function onSubmit(values: ContactInquiryInput) {
    submitInquiry.mutate(
      { data: { ...values, name: values.name.trim(), email: values.email.trim(), organization: values.organization?.trim() || undefined, message: values.message.trim(), website: values.website || '' } },
      {
        onSuccess: () => form.reset(),
      },
    );
  }

  const errorText = submitInquiry.isError
    ? 'Your message could not be delivered just now. Please try again in a moment.'
    : null;

  return (
    <main className="public-page grain" data-testid="page-contact">
      <PublicHeader current="contact" />
      <section className="contact-layout page-in">
        <div className="contact-intro">
          <div className="public-eyebrow"><span />LET’S TALK ABOUT YOUR PRACTICE</div>
          <h1 className="serif" data-testid="text-contact-title">A good conversation starts with <em>clarity.</em></h1>
          <p className="public-lede" data-testid="text-contact-intro">Tell us a little about what you need. We’ll get back to you with a thoughtful response.</p>
          <div className="contact-side-note">
            <div className="contact-note-icon"><Mail aria-hidden="true" /></div>
            <div><strong>For firms doing careful work</strong><p>ClientGuard is made for Australian law firms and financial-service providers managing client relationships and matters.</p></div>
          </div>
          <div className="contact-response-mark"><span className="contact-mark-line" /><span>PERSONAL, PROFESSIONAL, PRIVATE</span></div>
        </div>

        <section className="contact-form-panel" aria-labelledby="contact-form-heading">
          <div className="contact-form-heading">
            <span className="form-step">01 <span>/ INQUIRY</span></span>
            <h2 className="serif" id="contact-form-heading">Send us a note</h2>
            <p>We’ll use your details only to respond to your inquiry.</p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contact-form" noValidate data-testid="form-contact">
              <div className="contact-fields-two">
                <label className="contact-field" data-testid="field-contact-name">
                  <span>Name <b>Required</b></span>
                  <input {...form.register('name')} autoComplete="name" placeholder="Your name" aria-invalid={!!form.formState.errors.name} data-testid="input-contact-name" />
                  {form.formState.errors.name && <small className="field-error" data-testid="error-contact-name">{form.formState.errors.name.message}</small>}
                </label>
                <label className="contact-field" data-testid="field-contact-email">
                  <span>Email <b>Required</b></span>
                  <input {...form.register('email')} type="email" autoComplete="email" placeholder="you@firm.com.au" aria-invalid={!!form.formState.errors.email} data-testid="input-contact-email" />
                  {form.formState.errors.email && <small className="field-error" data-testid="error-contact-email">{form.formState.errors.email.message}</small>}
                </label>
              </div>
              <label className="contact-field" data-testid="field-contact-organization">
                <span>Organization <i>Optional</i></span>
                <input {...form.register('organization')} autoComplete="organization" placeholder="Firm or organization" aria-invalid={!!form.formState.errors.organization} data-testid="input-contact-organization" />
                {form.formState.errors.organization && <small className="field-error" data-testid="error-contact-organization">{form.formState.errors.organization.message}</small>}
              </label>
              <label className="contact-field" data-testid="field-contact-message">
                <span>How can we help? <b>Required</b></span>
                <textarea {...form.register('message')} rows={5} placeholder="A little context helps us give you a useful reply." aria-invalid={!!form.formState.errors.message} data-testid="input-contact-message" />
                <span className="contact-field-foot"><span>Keep it general, please.</span><span>{form.watch('message')?.length || 0} / 4,000</span></span>
                {form.formState.errors.message && <small className="field-error" data-testid="error-contact-message">{form.formState.errors.message.message}</small>}
              </label>
              <div className="contact-honeypot" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input {...form.register('website')} id="contact-website" tabIndex={-1} autoComplete="off" data-testid="input-contact-website" />
              </div>
              <div className="confidential-notice" data-testid="notice-confidential">
                <LockKeyhole aria-hidden="true" /><p>Please do not include confidential client or matter details in your message.</p>
              </div>
              {submitInquiry.isSuccess && <div className="form-status form-success" role="status" data-testid="status-contact-success"><span><Check aria-hidden="true" /></span><div><strong>Message received.</strong><p>Thank you for getting in touch. We’ll be in contact soon.</p></div></div>}
              {errorText && <div className="form-status form-error" role="alert" data-testid="status-contact-error"><CircleAlert aria-hidden="true" /><p>{errorText}</p></div>}
              <button type="submit" className="contact-submit" disabled={submitInquiry.isPending} data-testid="button-contact-submit">
                {submitInquiry.isPending ? <>Sending your message<span className="submit-dots" aria-hidden="true">···</span></> : <>Send inquiry <ArrowRight aria-hidden="true" /></>}
              </button>
              <p className="form-privacy-note" data-testid="text-contact-privacy">Your message is sent securely to the ClientGuard team.</p>
            </form>
          </Form>
        </section>
      </section>
      <section className="contact-bottom">
        <span>Prefer to explore first?</span>
        <Link href="/pricing" data-testid="link-contact-pricing">See the straightforward pricing <ChevronRight aria-hidden="true" /></Link>
      </section>
      <PublicFooter />
    </main>
  );
}
