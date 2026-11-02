import { FeatureBento } from "@/components/landing/feature-bento";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InsideRoom } from "@/components/landing/inside-room";
import { Manifesto } from "@/components/landing/manifesto";
import { ParallaxQuote } from "@/components/landing/parallax-quote";
import { ScrollToTop } from "@/components/landing/scroll-to-top";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { SourcesMarquee } from "@/components/landing/sources-marquee";
import { TalkTogether } from "@/components/landing/talk-together";
import { UseCases } from "@/components/landing/use-cases";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <SourcesMarquee />
        <Manifesto />
        <HowItWorks />
        <FeatureBento />
        <TalkTogether />
        <UseCases />
        <InsideRoom />
        <ParallaxQuote />
        <FinalCta />
      </main>
      <SiteFooter />
      <ScrollToTop />
    </>
  );
}
