export default () => (
  <board width="44mm" height="28mm">
    <pinheader name="J1" pinCount={2} pitch="2.54mm" footprint="pinrow2" pinLabels={{ pin1: "VIN", pin2: "GND" }} pcbX={-16} pcbRotation={90} />
    <chip
      name="U1"
      manufacturerPartNumber="AMS1117-3.3"
      supplierPartNumbers={{ jlcpcb: ["C6186"] }}
      footprint="sot223"
      pinLabels={{ pin1: "GND", pin2: "VOUT", pin3: "VIN", pin4: "TAB" }}
      connections={{ GND: "net.GND", VIN: "net.VIN", VOUT: "net.V3_3", TAB: "net.V3_3" }}
    />
    <capacitor name="C1" capacitance="10uF" footprint="0805" connections={{ pin1: "net.VIN", pin2: "net.GND" }} pcbX={-7} pcbY={-8} />
    <capacitor name="C2" capacitance="22uF" footprint="0805" connections={{ pin1: "net.V3_3", pin2: "net.GND" }} pcbX={7} pcbY={-8} />
    <capacitor name="C3" capacitance="100nF" footprint="0603" connections={{ pin1: "net.V3_3", pin2: "net.GND" }} pcbX={7} pcbY={8} />
    <resistor name="R1" resistance="1k" footprint="0603" connections={{ pin1: "net.V3_3" }} pcbX={-7} pcbY={8} />
    <led name="D1" color="green" footprint="0603" pcbX={-2} pcbY={8} />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.GND" />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" footprint="pinrow2" pinLabels={{ pin1: "V3_3", pin2: "GND" }} pcbX={16} pcbRotation={90} />
    <trace from=".J1 > .VIN" to="net.VIN" />
    <trace from=".J1 > .GND" to="net.GND" />
    <trace from=".J2 > .V3_3" to="net.V3_3" />
    <trace from=".J2 > .GND" to="net.GND" />
  </board>
)
