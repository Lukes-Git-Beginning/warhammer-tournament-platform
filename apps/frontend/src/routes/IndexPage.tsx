import { HeroSection } from '@/components/landing/HeroSection';
import { FundingSection } from '@/components/landing/FundingSection';
import { ActiveMustersSection } from '@/components/landing/ActiveMustersSection';
import { OpenPlaySection } from '@/components/landing/OpenPlaySection';
import { PersonalisedFactionBlock } from '@/components/landing/PersonalisedFactionBlock';
import { RollOfHonourSection } from '@/components/landing/RollOfHonourSection';
import { ConclaveSection } from '@/components/landing/ConclaveSection';
import { SigillumSection } from '@/components/landing/SigillumSection';
import { Footer } from '@/components/landing/Footer';

export function IndexPage() {
  return (
    <>
      <main id="main-content">
        <FundingSection compact />
        <HeroSection />
        <ActiveMustersSection />
        <OpenPlaySection />
        <PersonalisedFactionBlock />
        <RollOfHonourSection />
        <ConclaveSection />
        <SigillumSection />
      </main>
      <Footer />
    </>
  );
}
