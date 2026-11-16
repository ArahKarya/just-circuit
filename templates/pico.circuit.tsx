const PICO_PINS = {
  pin1: "GP0", pin2: "GP1", pin3: "GND1", pin4: "GP2", pin5: "GP3", pin6: "GP4", pin7: "GP5", pin8: "GND2",
  pin9: "GP6", pin10: "GP7", pin11: "GP8", pin12: "GP9", pin13: "GND3", pin14: "GP10", pin15: "GP11", pin16: "GP12",
  pin17: "GP13", pin18: "GND4", pin19: "GP14", pin20: "GP15", pin21: "GP16", pin22: "GP17", pin23: "GND5", pin24: "GP18",
  pin25: "GP19", pin26: "GP20", pin27: "GP21", pin28: "GND6", pin29: "GP22", pin30: "RUN", pin31: "GP26_A0", pin32: "GP27_A1",
  pin33: "AGND", pin34: "GP28_A2", pin35: "ADC_VREF", pin36: "V3V3_OUT", pin37: "V3V3_EN", pin38: "GND7", pin39: "VSYS", pin40: "VBUS",
} as const

export default () => (
  <board width="62mm" height="44mm">
    <chip
      name="U1"
      manufacturerPartNumber="SC0915"
      footprint="dip40_w17.78mm_p2.54mm"
      pinLabels={PICO_PINS}
      pcbRotation={90}
      connections={{ GND1: "net.GND", GND2: "net.GND", GND3: "net.GND", GND4: "net.GND", GND5: "net.GND", GND6: "net.GND", GND7: "net.GND", AGND: "net.GND" }}
    />
    {/* Status LED on GP15 */}
    <resistor name="R1" resistance="330" footprint="0603" pcbX={-14} pcbY={-17} />
    <led name="D1" color="green" footprint="0603" pcbX={-8} pcbY={-17} />
    <trace from=".U1 > .GP15" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.GND" />
    {/* Reset button: pulls RUN low */}
    <pushbutton name="SW1" footprint="pushbutton" pcbX={20} pcbY={-16} />
    <trace from=".SW1 > .pin1" to=".U1 > .RUN" />
    <trace from=".SW1 > .pin2" to="net.GND" />
  </board>
)
