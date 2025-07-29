import React from "react";

const InputField = ({ label, name, value, onChange }) => (
  <div>
    <label className="block text-gray-700">{label}</label>
    <input
      type="text"
      name={name}
      value={value}
      onChange={onChange}
      className="w-full border border-gray-300 rounded px-2 py-1"
    />
  </div>
);

export default InputField;
