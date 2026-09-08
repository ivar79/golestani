<?php
namespace App\Console\Commands;
use App\Models\Role;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
class ProvisionAdmin extends Command
{
    protected $signature = 'admin:provision {phone : Iranian mobile number}';
    protected $description = 'Interactively create an administrator or rotate an existing admin password';
    public function handle(): int
    {
        $phone=(string)$this->argument('phone');
        if (!preg_match('/^09[0-9]{9}$/',$phone)) { $this->error('Invalid mobile number.');return self::FAILURE; }
        $existing=User::where('phone',$phone)->first();
        if ($existing && !$existing->hasRole('admin')) { $this->error('Existing account is not an admin; role promotion is not performed by this command.');return self::FAILURE; }
        if ($existing && !$this->confirm('Rotate this admin password, revoke its tokens and recovery code?',false)) return self::FAILURE;
        $password=(string)$this->secret('New password (at least 16 characters)');
        if (mb_strlen($password)<16 || $password!==$this->secret('Repeat new password')) { $this->error('Password too short or confirmation mismatch.');return self::FAILURE; }
        DB::transaction(function () use ($phone,$password):void {
            Role::firstOrCreate(['name'=>'admin'],['display_name'=>'مدیر کل سیستم']);
            $u=User::where('phone',$phone)->lockForUpdate()->first();
            if ($u && !$u->hasRole('admin')) throw new \RuntimeException('Account changed; no modification made.');
            if (!$u) $u=new User(['phone'=>$phone,'name'=>'مدیر سامانه','is_active'=>true]);
            $u->password=Hash::make($password);$u->recovery_code=null;$u->save();$u->assignRole('admin');$u->tokens()->delete();
            DB::table('audit_events')->insert(['actor_id'=>null,'event'=>'admin.credentials_rotated','subject_type'=>'user','subject_id'=>$u->id,'metadata'=>json_encode(['source'=>'console'],JSON_THROW_ON_ERROR),'created_at'=>now()]);
        });
        $this->info('Administrator credentials saved. No password was written to logs.');
        return self::SUCCESS;
    }
}
