import { HeroSection } from '@/components/landing/HeroSection';
import { ForgeSection } from '@/components/landing/ForgeSection';
import { ActiveMustersSection } from '@/components/landing/ActiveMustersSection';
import { PersonalisedFactionBlock } from '@/components/landing/PersonalisedFactionBlock';
import { RollOfHonourSection } from '@/components/landing/RollOfHonourSection';
import { ConclaveSection } from '@/components/landing/ConclaveSection';
import { SigillumSection } from '@/components/landing/SigillumSection';
import { Footer } from '@/components/landing/Footer';

export function IndexPage() {
  return (
    <>
      <main id="main-content">
        <HeroSection />
        <ForgeSection />
        <ActiveMustersSection />
        <PersonalisedFactionBlock />
        <RollOfHonourSection />
        <ConclaveSection />
        <SigillumSection />
      </main>
      <Footer />
    </>
  );
}
