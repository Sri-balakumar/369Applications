from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    device_ids = fields.One2many('employee.device', 'employee_id', string='Devices')

    # Live red warning under the PIN field when another employee already uses
    # the same PIN (the phone app logs in by PIN, so PINs must be unique).
    pin_conflict_msg = fields.Char(
        compute='_compute_pin_conflict_msg',
        store=False,
    )

    def _pin_owner(self, pin):
        """Another employee (any company) already using `pin`, if any."""
        self.ensure_one()
        pin = (pin or '').strip()
        if not pin:
            return self.browse()
        return self.sudo().search(
            [('pin', '=', pin), ('id', '!=', self._origin.id or 0)], limit=1)

    def _pin_conflict_text(self, owner):
        return _("%s is already using this PIN. Please keep a different PIN.", owner.name)

    @api.depends('pin')
    def _compute_pin_conflict_msg(self):
        for emp in self:
            owner = emp._pin_owner(emp.pin)
            emp.pin_conflict_msg = emp._pin_conflict_text(owner) if owner else False

    @api.constrains('pin')
    def _check_unique_pin(self):
        for emp in self:
            # A PIN is only usable from a registered phone, so the Device ID
            # must exist first. Runs after the device_code inverse, so entering
            # Device ID + PIN together in one save is fine.
            if (emp.pin or '').strip() and not emp._primary_device():
                raise ValidationError(_(
                    "Enter the Device ID for %s before setting a PIN.", emp.name))
            owner = emp._pin_owner(emp.pin)
            if owner:
                raise ValidationError(emp._pin_conflict_text(owner))

    # Single editable view of the employee's device, surfaced so the
    # Attendances → Devices list shows one row per employee
    # (Name / Device ID / Active / PIN / Added On / Last Used). Reading reflects
    # the employee's primary device (active preferred, archived ones included);
    # writing find-or-creates / updates that device record — which also shows
    # under the employee form's Devices tab.
    device_code = fields.Char(
        string='Device ID',
        compute='_compute_device_fields',
        inverse='_inverse_device_code',
        store=False,
    )
    device_name = fields.Char(
        string='Device Name',
        compute='_compute_device_fields',
        store=False,
    )
    device_active = fields.Boolean(
        string='Active',
        compute='_compute_device_fields',
        inverse='_inverse_device_active',
        store=False,
    )
    device_added_date = fields.Datetime(
        string='Device Added On',
        compute='_compute_device_fields',
        store=False,
    )
    device_last_used = fields.Datetime(
        string='Last Used',
        compute='_compute_device_fields',
        store=False,
    )

    def _primary_device(self):
        """The employee's primary device — active first — INCLUDING archived
        ones (so a deactivated device still shows up and can be toggled back)."""
        self.ensure_one()
        Device = self.env['employee.device'].with_context(active_test=False)
        return Device.search(
            [('employee_id', '=', self.id)],
            order='active desc, create_date desc', limit=1,
        )

    @api.depends('device_ids', 'device_ids.device_id', 'device_ids.active',
                 'device_ids.create_date', 'device_ids.last_used', 'device_ids.device_name')
    def _compute_device_fields(self):
        for emp in self:
            dev = emp._primary_device()
            emp.device_code = dev.device_id if dev else False
            emp.device_name = dev.device_name if dev else False
            emp.device_active = dev.active if dev else False
            emp.device_added_date = dev.create_date if dev else False
            emp.device_last_used = dev.last_used if dev else False

    def _inverse_device_code(self):
        Device = self.env['employee.device'].with_context(active_test=False)
        for emp in self:
            code = (emp.device_code or '').strip()
            if not code:
                continue
            same = Device.search(
                [('employee_id', '=', emp.id), ('device_id', '=', code)], limit=1)
            if same:
                same.write({'active': True})
                continue
            existing = emp._primary_device()
            if existing:
                existing.write({'device_id': code, 'active': True})
            else:
                Device.create({
                    'employee_id': emp.id,
                    'device_id': code,
                    'active': True,
                })

    def _inverse_device_active(self):
        for emp in self:
            dev = emp._primary_device()
            if dev:
                dev.write({'active': bool(emp.device_active)})
