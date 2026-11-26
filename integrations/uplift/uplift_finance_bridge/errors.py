class ReceiptError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code = code
        self.status = status


def require(condition, code="receipt_request_invalid", status=400):
    if not condition:
        raise ReceiptError(code, status)


def text(value, maximum=1000, empty=False):
    require(isinstance(value, str) and len(value) <= maximum and (empty or value.strip()))
    return value.strip()


def bounded_int(value, low=0, high=9_000_000_000_000):
    require(type(value) is int and low <= value <= high)
    return value
