import React from "react";

const Button = ({ onClick, children, disabled }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
  >
    {children}
  </button>
);

export default Button;
