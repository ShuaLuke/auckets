// =============================================================
// AUCKETS UI Kit — Icon wrapper
// Loads Lucide via CDN and exposes a small <Icon> component.
// Lucide is the SUBSTITUTE icon set for this design system —
// the codebase doesn't ship icons yet. Flagged in README.
// =============================================================

const Icon = ({ name, size = 16, strokeWidth = 1.75, color, style: extraStyle, ...rest }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (window.lucide && ref.current) {
      window.lucide.createIcons({
        nameAttr: 'data-lucide',
        attrs: { width: size, height: size, 'stroke-width': strokeWidth },
        icons: window.lucide.icons,
      });
    }
  }, [name, size, strokeWidth]);
  const style = { display: 'inline-flex', color: color, lineHeight: 0, ...extraStyle };
  return (
    <span ref={ref} style={style} {...rest}>
      <i data-lucide={name}></i>
    </span>
  );
};

Object.assign(window, { Icon });
