import React from "react";
import { FixedSizeList } from "react-window";

const LISTBOX_PADDING = 8;

function renderRow(props) {
  const { data, index, style } = props;
  const item = data[index];

  return (
    <div style={{ ...style, top: style.top + LISTBOX_PADDING }}>{item}</div>
  );
}

const ListboxComponent = React.forwardRef(function ListboxComponent(
  props,
  ref
) {
  const { children, showFooter, ...other } = props;

  const itemData = Array.isArray(children) ? children : [children];
  const itemCount = itemData.length;
  const itemSize = 56;
  const height = Math.min(8, itemCount) * itemSize + 2 * LISTBOX_PADDING;

  return (
    <div ref={ref} {...other}>
      <FixedSizeList
        height={height}
        width="100%"
        itemSize={itemSize}
        itemCount={itemCount}
        itemData={itemData}
        outerElementType="div"
        innerElementType="ul"
      >
        {renderRow}
      </FixedSizeList>
      {showFooter && (
        <li aria-disabled="true">
          <div style={{ textAlign: "center", padding: 8, color: "#6b7280" }}>
            Loading…
          </div>
        </li>
      )}
    </div>
  );
});

export default ListboxComponent;
