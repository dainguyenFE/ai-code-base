function FirstBranch() {
  return <div>first</div>;
}

function SecondBranch() {
  return <div>second</div>;
}

function FallbackBranch() {
  return <div>fallback</div>;
}

export function PricingGateFixture({
  ready,
  visible,
}: {
  ready: boolean;
  visible: boolean;
}) {
  if (!ready) {
    return <FirstBranch />;
  }

  if (!visible) {
    return <SecondBranch />;
  }

  return <FallbackBranch />;
}
