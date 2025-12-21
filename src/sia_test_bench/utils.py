import enum

class PumpTypeObj:
    def __init__(
        self, name: str, ml_per_pulse: float, gallons_pp, max_rpm: float = 80
    ):
        self.name = name
        self.ml_per_pulse = ml_per_pulse
        self.gallons_pp = gallons_pp
        self.max_rpm = max_rpm

    def __eq__(self, other):
        if isinstance(other, PumpTypeObj):
            return self.name == other.name
        return False

    def __str__(self):
        return self.name

    @property
    def display_name(self):
        return self.name.replace("_", " ").title()

    def get_min_rate(self, max_rpm: float = None, is_gallons: bool = False, flow_rate_denom: float = 3600):
        ## Assuming min is 2 seconds out of 60 seconds
        return self.get_max_rate(max_rpm, is_gallons, flow_rate_denom) * (2.0 / 60.0)

    def get_max_rate(self, max_rpm: float = None, is_gallons: bool = False, flow_rate_denom: float = 3600):
        # flow_rate_denom is in seconds, so 3600 for L/Hr or 86400 for L/Day
        if max_rpm:
            return (max_rpm/60) * flow_rate_denom * self.get_displacement(is_gallons)/1000
        return (self.max_rpm/60) * flow_rate_denom * self.get_displacement(is_gallons)/1000

    def get_displacement(self, gallons: bool):
        if gallons:
            return self.gallons_pp
        return self.ml_per_pulse

class PumpType(enum.Enum):
    l15_1_8 = PumpTypeObj("l15_1/8", 0.2, 0.053) # max flow = 0.2ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 0.96 L/HR
    l25_1_4 = PumpTypeObj("l25_1/4", 0.8, 0.211) # max flow = 0.8ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 3.84L/HR
    l35_3_8 = PumpTypeObj("l35_3/8", 1.8, 0.476) # max flow = 1.8ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 8.64 L/HR
    l50_1_2 = PumpTypeObj("l50_1/2", 3.2, 0.845) # max flow = 3.2ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 15.36 L/HR
    l75_3_4 = PumpTypeObj("l75_3/4", 7.2, 1.902) # max flow = 7.2ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 34.56 L/HR
    l100_1 = PumpTypeObj("l100_1", 12.8, 3.381) # max flow = 12.8ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 61.44 L/HR
    l150_1_1_2 = PumpTypeObj("l150_1_1/2", 28.5, 7.529) # max flow = 28.5ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 136.8 L/HR
    l225_2_1_4 = PumpTypeObj("l225_2_1/4", 65, 17.171) # max flow = 65ml * 80 rpm * 60 minutes/hour / 1000 ml/L = 312 L/HR


