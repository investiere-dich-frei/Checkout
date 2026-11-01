import type { Block, BlockArea, PageContent } from "@idf/db/checkout-page-content";
import type { CSSProperties, ReactNode } from "react";

/**
 * Darstellung einer Kaufseite. Wird von der echten Kaufseite und von der Vorschau im
 * Editor benutzt; deshalb ohne Datenbankzugriff und ohne Hooks.
 *
 * Texte sind reiner Text: Leerzeile = neuer Absatz, **so** = fett. HTML wird nie
 * übernommen, React setzt alles als Text.
 */

export const imageUrl = (id: string) => `/bilder/${id}`;

/** Logo aus dem Brandbook, wenn auf der Seite kein eigenes Logo hochgeladen ist. */
export const BRAND_LOGO = "/marke/logo-bunt.png";

/** Weiß oder Dunkelgrau als Schrift auf der Akzentfarbe, je nachdem, was besser lesbar ist. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Kontrast zu Weiß gegen Kontrast zu #222.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0687 ? "#ffffff" : "#222222";
}

function inline(line: string, key: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : part,
  );
}

export function RichText(props: { text: string; className?: string }) {
  const paragraphs = props.text.split(/\n{2,}/).filter((p) => p.trim() !== "");
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={props.className}>
          {p.split("\n").flatMap((line, j) => (j === 0 ? inline(line, `${i}-${j}`) : [<br key={`br-${i}-${j}`} />, ...inline(line, `${i}-${j}`)]))}
        </p>
      ))}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "ueberschrift":
      return block.text ? <h2 className="cp-heading">{block.text}</h2> : null;
    case "text":
      return (
        <div className="cp-text">
          <RichText text={block.text} />
        </div>
      );
    case "liste":
      return (
        <div className="cp-list">
          {block.title && <h3>{block.title}</h3>}
          <ul>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item, String(i))}</li>
            ))}
          </ul>
        </div>
      );
    case "bild":
      // eslint-disable-next-line @next/next/no-img-element
      return <img className="cp-image" src={imageUrl(block.imageId)} alt={block.alt} loading="lazy" />;
    case "zitat":
      return (
        <figure className="cp-quote">
          <blockquote>
            <RichText text={block.text} />
          </blockquote>
          {(block.name || block.imageId) && (
            <figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {block.imageId && <img src={imageUrl(block.imageId)} alt="" loading="lazy" />}
              {block.name && <span>{block.name}</span>}
            </figcaption>
          )}
        </figure>
      );
    case "person":
      return (
        <div className="cp-person">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {block.imageId && <img src={imageUrl(block.imageId)} alt="" loading="lazy" />}
          <div>
            {block.title && <h3>{block.title}</h3>}
            <RichText text={block.text} />
          </div>
        </div>
      );
    case "vertrauen":
      return (
        <ul className="cp-trust">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
  }
}

export function Blocks(props: { blocks: Block[]; area: BlockArea }) {
  const list = props.blocks.filter((b) => b.area === props.area);
  if (!list.length) return null;
  return (
    <>
      {list.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

export function Steps(props: { current: 1 | 2 }) {
  return (
    <ol className="cp-steps" aria-label="Schritte">
      <li aria-current={props.current === 1 ? "step" : undefined}>
        <span>01</span> Kunde
      </li>
      <li aria-current={props.current === 2 ? "step" : undefined}>
        <span>02</span> Zahlung
      </li>
    </ol>
  );
}

/**
 * Abschnitt zwischen Kopfbereich und Bestellung. Beginnt er mit einem Bild, steht das Bild
 * links und der Rest rechts daneben (wie „Bundle“ und „Her Options“ bei Thrivecart).
 */
function MiddleSection(props: { blocks: Block[] }) {
  const [first, ...rest] = props.blocks;
  const split = first?.type === "bild" && rest.length > 0;
  return (
    <section className="cp-middle">
      <div className={split ? "cp-middle-inner cp-middle-split" : "cp-middle-inner"}>
        {split ? (
          <>
            <div className="cp-middle-media">
              <BlockView block={first} />
            </div>
            <div>
              {rest.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </div>
          </>
        ) : (
          props.blocks.map((b, i) => <BlockView key={i} block={b} />)
        )}
      </div>
    </section>
  );
}

/** Die ganze Kaufseite; `form` ist das Bestellformular (in der Vorschau ein Platzhalter). */
export function CheckoutPageView(props: { content: PageContent; productName: string; optionLabel: string; form: ReactNode }) {
  const c = props.content;
  const hasContent = c.blocks.some((b) => b.area === "inhalt");
  const style = { "--accent": c.accentColor, "--on-accent": textOn(c.accentColor) } as CSSProperties;
  return (
    <div className="checkout-page" style={style}>
      <header className="cp-hero">
        <div className="cp-hero-inner">
          <div className="cp-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="cp-logo" src={c.logoImageId ? imageUrl(c.logoImageId) : BRAND_LOGO} alt="Investiere Dich Frei – Die Emilia Bolda Finanzakademie" />
          </div>
          <div className={c.heroImageId ? "cp-hero-grid" : undefined}>
            <div>
              <h1>{c.headline || props.productName}</h1>
              {c.subheadline && (
                <div className="cp-sub">
                  <RichText text={c.subheadline} />
                </div>
              )}
              {c.ctaText && (
                <a className="cp-cta" href="#bestellen">
                  {c.ctaText}
                </a>
              )}
            </div>
            {c.heroImageId && (
              <div className="cp-hero-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="cp-hero-image" src={imageUrl(c.heroImageId)} alt="" />
              </div>
            )}
          </div>
        </div>
      </header>

      {c.blocks.some((b) => b.area === "mitte") && <MiddleSection blocks={c.blocks.filter((b) => b.area === "mitte")} />}

      <section className="cp-order" aria-label="Bestellung">
        <div className={hasContent ? "cp-columns" : "cp-columns cp-single"}>
          {hasContent && (
            <div className="cp-content">
              <Blocks blocks={c.blocks} area="inhalt" />
            </div>
          )}
          <div className="cp-checkout" id="bestellen">
            <div className="cp-product">
              <strong>{props.productName}</strong>
              <span className="note">{props.optionLabel}</span>
            </div>
            <Blocks blocks={c.blocks} area="formular" />
            {props.form}
          </div>
        </div>
      </section>

      {c.blocks.some((b) => b.area === "unten") && (
        <div className="cp-bottom">
          <div className="cp-bottom-inner">
            <Blocks blocks={c.blocks} area="unten" />
          </div>
        </div>
      )}
    </div>
  );
}
